import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { promises as fsPromises, existsSync } from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import type { DownloadTask, EngineContext, TaskRuntime, AudioFormat, VideoFormat } from '../types'
import { AUDIO_FORMATS, VIDEO_FORMATS } from '../types'
import { getBinaryPath, getCookiesPath } from '../paths'
import { nowMs, sanitizeFilename, getFileSizeIfExists, parseTimeToSeconds, sendNotification, killProcessTree } from '../utils'
import {
  parseDownloadProgress,
  parseFfmpegProgress,
  parseStateTransition,
  flushLines,
} from '../progressParser'
import type { FfmpegState } from '../progressParser'
import type { IEngine } from './IEngine'
import { getJsRuntimeArgs } from '../ytdlp'

type Profile = 'proAudio' | 'bestVideo' | 'default'

/**
 * YoutubeEngine — professional yt-dlp adapter.
 *
 * Guarantees:
 * - yt-dlp binary is updated once per process (`yt-dlp --update`)
 * - metadata is fetched before download (`--dump-json`)
 * - optimized argument profiles:
 *   - Pro Audio (mp3): -x --audio-format mp3 --audio-quality 0 (requires FFmpeg)
 *   - Best Video (mp4): -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best" (requires FFmpeg)
 * - progress is parsed and pushed via EngineContext into the orchestrator/UI
 */
export class YoutubeEngine implements IEngine {
  private static updatePromise: Promise<void> | null = null
  private childProcess: ChildProcessWithoutNullStreams | null = null

  async download(task: DownloadTask, context?: EngineContext): Promise<void> {
    if (!context) throw new Error('[YoutubeEngine] Missing EngineContext')

    // 1) Keep yt-dlp binary fresh (silent, once per process)
    await YoutubeEngine.ensureYtdlpFresh()

    const runtime = context.runtime
    this.childProcess = null

    // 2) Dependency checks (especially FFmpeg for merge/audio)
    const ytDlpPath = getBinaryPath('yt-dlp')
    const ffmpegPath = getBinaryPath('ffmpeg')
    const ffmpegDir = path.dirname(ffmpegPath)

    const profile = this.selectProfile(task)
    const requiresFfmpeg = profile === 'proAudio' || profile === 'bestVideo' || task.targetFormat !== 'webm'
    if (!existsSync(ytDlpPath)) {
      task.status = 'error'
      task.errorMessage = 'yt-dlp binary is missing from the bin directory.'
      task.updatedAtMs = nowMs()
      context.sendUpdate(task)
      return
    }

    if ((requiresFfmpeg && !existsSync(ffmpegPath)) || (profile !== 'default' && !existsSync(ffmpegPath))) {
      task.status = 'error'
      task.errorMessage = 'ffmpeg binary is missing. Required for selected yt-dlp profile.'
      task.updatedAtMs = nowMs()
      context.sendUpdate(task)
      return
    }

    // 3) Initialize runtime
    runtime.abortController?.abort()
    runtime.abortController = new AbortController()
    runtime.lastSpeedSampleAtMs = null
    runtime.lastSpeedSampleBytes = null
    runtime.retries = runtime.retries ?? 0

    // Reset and enter downloading state
    task.status = 'downloading'
    task.errorMessage = null
    task.updatedAtMs = nowMs()
    context.sendUpdate(task)

    // 4) Metadata pre-fetch (title/duration/thumbnail) before starting download
    await this.prefetchMetadata(task, context, runtime).catch((e) => {
      // Non-fatal; continue without metadata.
      log.warn(`[YoutubeEngine] Metadata prefetch failed for ${task.id}:`, e instanceof Error ? e.message : e)
    })

    // 5) Spawn yt-dlp with optimized arguments and machine-parseable progress templates
    const args = this.buildYtdlpArgs(task, profile, { ffmpegDir })
    const proc = spawn(ytDlpPath, args, {
      windowsHide: true,
      detached: false,
      env: { ...process.env, PYTHONUNBUFFERED: '1', ELECTRON_RUN_AS_NODE: '1' },
    })

    this.childProcess = proc
    runtime.child = proc

    log.info(`[YoutubeEngine] Spawned yt-dlp for task ${task.id} (profile=${profile})`)

    // Progress parsing state
    const preseedDuration = this.computePreseedDuration(task)
    const ffmpegState: FfmpegState = { totalDuration: preseedDuration, stderr: '' }
    let stdoutBuf = ''
    let stderrBuf = ''
    let lastUpdateAtMs = 0
    let detectedFinalPath: string | null = null

    const progressCtx = {
      sendUpdate: (t: DownloadTask) => context.sendUpdate(t),
      saveState: () => context.saveState(),
    }

    const MAX_STDERR_BYTES = 64 * 1024

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      ffmpegState.stderr += chunk
      if (ffmpegState.stderr.length > MAX_STDERR_BYTES) {
        ffmpegState.stderr = ffmpegState.stderr.slice(-MAX_STDERR_BYTES)
      }

      let lines: string[]
      ;[lines, stderrBuf] = flushLines(stderrBuf, chunk)

      for (const line of lines) {
        if (!line.trim()) continue

        const ffmpegChanged = parseFfmpegProgress(line, task, ffmpegState)
        let dlChanged = false
        if (task.status === 'downloading') dlChanged = parseDownloadProgress(line, task)

        if (ffmpegChanged || dlChanged) {
          const now = nowMs()
          if (now - lastUpdateAtMs > 200) {
            task.updatedAtMs = now
            lastUpdateAtMs = now
            context.sendUpdate(task)
          }
        }

        const { detectedPath } = parseStateTransition(line, task, ffmpegState, progressCtx)
        if (detectedPath) detectedFinalPath = detectedPath
      }
    })

    proc.stdout.on('data', (data: Buffer) => {
      let lines: string[]
      ;[lines, stdoutBuf] = flushLines(stdoutBuf, data.toString())

      let stateChanged = false
      for (const line of lines) {
        if (!line.trim()) continue

        const { transitioned, detectedPath } = parseStateTransition(line, task, ffmpegState, progressCtx)
        if (detectedPath) detectedFinalPath = detectedPath
        if (transitioned) {
          stateChanged = true
          continue
        }

        if (task.status === 'downloading' && parseDownloadProgress(line, task)) stateChanged = true
        if (parseFfmpegProgress(line, task, ffmpegState)) stateChanged = true
      }

      const now = nowMs()
      if (stateChanged && now - lastUpdateAtMs > 200) {
        task.updatedAtMs = now
        lastUpdateAtMs = now
        context.sendUpdate(task)
        if (Math.random() < 0.02) context.saveState()
      }
    })

    const exitCode: number = await new Promise((resolve) => {
      proc.on('close', (code) => resolve(code ?? 1))
      proc.on('error', () => resolve(1))
    })

    // If the user paused/canceled, don't overwrite state.
    if (runtime.abortController?.signal.aborted) return

    // Find if a valid downloaded file exists at this point
    let downloadedTempPath: string | null = detectedFinalPath
    if (!downloadedTempPath || !existsSync(downloadedTempPath)) {
      try {
        const files = await fsPromises.readdir(task.directory)
        downloadedTempPath = files
          .map((f) => path.join(task.directory, f))
          .find((p) => path.basename(p).startsWith(`${task.id}.`)) ?? null
      } catch {
        downloadedTempPath = null
      }
    }

    // Treat as success if exit code is 0 OR if we actually produced a file with some reasonable data
    let isSuccess = exitCode === 0
    if (!isSuccess && downloadedTempPath && existsSync(downloadedTempPath)) {
      const sizeTemp = await getFileSizeIfExists(downloadedTempPath)
      // If we have a file with more than 50KB or download progress indicated > 0, it's likely successfully fetched but ffmpeg gave a warning
      if (sizeTemp > 50 * 1024 || task.downloadedBytes > 0) {
        log.warn(`[YoutubeEngine] Task ${task.id} exited with ${exitCode} but generated file. Treating as success.`)
        isSuccess = true
      }
    }

    if (isSuccess) {
      // Rename/move final output to the orchestrator's expected task.filePath
      await this.renameDownloaded(task, downloadedTempPath || detectedFinalPath)

      task.status = 'completed'
      task.updatedAtMs = nowMs()
      runtime.retries = 0

      const finalSize = await getFileSizeIfExists(task.filePath)
      if (finalSize > 0) {
        task.totalBytes = finalSize
        task.downloadedBytes = finalSize
        context.sendStats(task.id, finalSize)
      }

      context.flushSave()
      context.sendUpdate(task)
      sendNotification('Download Complete', `${task.title || task.filename} downloaded successfully.`)
      return
    }

    // Error path: build message from captured stderr
    const finalMessage = this.buildErrorMessage(ffmpegState.stderr)
    log.error(`[YoutubeEngine] Task ${task.id} exited with code ${exitCode}: ${finalMessage}`)

    // Retry with exponential backoff (common for bot/network disconnects)
    const MAX_RETRIES = 5
    if (runtime.retries < MAX_RETRIES) {
      runtime.retries++
      const backoffMs = Math.min(3000 * 2 ** (runtime.retries - 1), 60_000)
      task.status = 'queued'
      task.errorMessage = `Download failed, retrying (${runtime.retries}/${MAX_RETRIES})...`
      task.updatedAtMs = nowMs()
      context.sendUpdate(task)
      await new Promise<void>((r) => setTimeout(r, backoffMs))
      return
    }

    task.status = 'error'
    task.errorMessage = finalMessage
    task.updatedAtMs = nowMs()
    context.flushSave()
    context.sendUpdate(task)
    sendNotification('Download Failed', `Failed to download ${task.title || task.filename}`)
  }

  pause(): void {
    // Orchestrator will also abort and kill process tree.
    log.info(`[YoutubeEngine] Pausing (Killing) process...`)
    killProcessTree(this.childProcess)
  }

  stop(): void {
    log.info(`[YoutubeEngine] Stopping (Killing) process...`)
    killProcessTree(this.childProcess)
  }

  private static async ensureYtdlpFresh(): Promise<void> {
    if (YoutubeEngine.updatePromise) return YoutubeEngine.updatePromise

    const ytdlpPath = getBinaryPath('yt-dlp')
    if (!existsSync(ytdlpPath)) return

    YoutubeEngine.updatePromise = new Promise<void>((resolve) => {
      try {
        const p = spawn(ytdlpPath, ['--update', '--no-color', '--quiet', '--no-warnings'], {
          windowsHide: true,
          detached: false,
          stdio: 'ignore',
        })
        p.on('close', () => resolve())
        p.on('error', () => resolve())
      } catch {
        resolve()
      }
    })

    return YoutubeEngine.updatePromise
  }

  private selectProfile(task: DownloadTask): Profile {
    if (task.targetFormat === 'mp3') return 'proAudio'
    if (task.targetFormat === 'mp4') return 'bestVideo'
    return 'default'
  }

  private computePreseedDuration(task: DownloadTask): number | null {
    if (task.startTime && task.endTime) {
      const td = parseTimeToSeconds(task.endTime) - parseTimeToSeconds(task.startTime)
      if (td > 0) return td
    }
    return null
  }

  private async prefetchMetadata(task: DownloadTask, context: EngineContext, runtime: TaskRuntime): Promise<void> {
    const ytDlpPath = getBinaryPath('yt-dlp')

    const META_TIMEOUT_MS = 15_000
    const metaArgs = [
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      '--no-check-certificate',
      '--no-mtime',
      '--geo-bypass',
      '--force-ipv4',
      ...this.buildAuthArgs(task),
      task.url,
    ]

    const proc = spawn(ytDlpPath, metaArgs, { windowsHide: true, detached: false, env: { ...process.env, PYTHONUNBUFFERED: '1', ELECTRON_RUN_AS_NODE: '1' } })

    const metaOut = await Promise.race<string>([
      (async () => {
        let out = ''
        for await (const chunk of proc.stdout) out += chunk.toString()
        return out
      })(),
      new Promise<string>((_, rej) =>
        setTimeout(() => {
          try { proc.kill() } catch { /* ignore */ }
          rej(new Error('meta timeout'))
        }, META_TIMEOUT_MS)
      ),
    ])

    if (!metaOut || runtime.abortController?.signal.aborted) return

    let info: any = null
    try {
      info = JSON.parse(metaOut.trim())
    } catch {
      // Fallback: try to parse the first JSON object in case stderr prefixed output.
      const start = metaOut.indexOf('{')
      const end = metaOut.lastIndexOf('}')
      if (start >= 0 && end > start) info = JSON.parse(metaOut.slice(start, end + 1))
    }

    if (!info) return

    if (info.title) task.title = String(info.title)

    // Duration requested (not currently persisted to DownloadTask UI).
    if (typeof info.duration === 'number') {
      log.info(`[YoutubeEngine] Duration for ${task.id}: ${info.duration}s`)
    }

    const thumbs = Array.isArray(info.thumbnails) ? info.thumbnails : null
    const thumb =
      info.thumbnail
      ?? (thumbs && thumbs.length ? thumbs[thumbs.length - 1]?.url : null)

    if (thumb) task.thumbnail = String(thumb)

    task.updatedAtMs = nowMs()
    context.sendUpdate(task)
  }

  private buildAuthArgs(task: DownloadTask): string[] {
    const args: string[] = []
    const cookiesPath = getCookiesPath()

    // Authentication / cookies
    if (task.username) args.push('--username', task.username)
    if (task.password) args.push('--password', task.password)

    if (task.cookieFile) {
      args.push('--cookies', task.cookieFile)
    } else if (cookiesPath) {
      args.push('--cookies', cookiesPath)
    } else if (task.cookieBrowser && task.cookieBrowser !== 'none') {
      args.push('--cookies-from-browser', task.cookieBrowser)
    }

    if (task.speedLimit && task.speedLimit !== 'auto') args.push('--limit-rate', task.speedLimit)

    // Section trimming
    if (task.startTime || task.endTime) {
      const start = task.startTime || '00:00:00'
      const end = task.endTime || 'inf'
      args.push('--download-sections', `*${start}-${end}`)
    }

    return args
  }

  private buildYtdlpArgs(
    task: DownloadTask,
    profile: Profile,
    opts: { ffmpegDir: string },
  ): string[] {
    const ytArgs: string[] = [
      '--newline',
      '--progress',
      '--no-check-certificate',
      '--no-mtime',
      '--no-playlist',
      '--geo-bypass',
      '--force-ipv4',
      '--no-warnings',
      '--force-overwrites',
      '--postprocessor-args', 'ffmpeg:-y -threads 2',
      '--progress-template', 'download:CORTEX_DL:%(progress.downloaded_bytes)s:%(progress.total_bytes_estimate)s:%(progress.speed)s',
      '--progress-template', 'postprocess:CORTEX_PP:%(info.filepath)s',
      '--resize-buffer',
      '--file-access-retries', '5',
      '--socket-timeout', '10',
      ...this.buildAuthArgs(task),
      ...getJsRuntimeArgs(),
    ]

    // FFmpeg location helps yt-dlp find ffmpeg reliably in packaged setups.
    const ffmpegExePath = getBinaryPath('ffmpeg')
    if (existsSync(ffmpegExePath)) ytArgs.push('--ffmpeg-location', opts.ffmpegDir)

    // Profile-specific format selection
    switch (profile) {
      case 'proAudio': {
        // Pro Audio profile requested:
        // -x --audio-format mp3 --audio-quality 0
        ytArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '0')
        ytArgs.push('-f', 'bestaudio/best')
        break
      }
      case 'bestVideo': {
        // Best Video profile requested:
        // -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best"
        ytArgs.push(
          '-f',
          'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best'
        )
        ytArgs.push('--merge-output-format', 'mp4')
        break
      }
      default: {
        // Conservative defaults for other target formats.
        if (AUDIO_FORMATS.includes(task.targetFormat as AudioFormat)) {
          let audioFmt = task.targetFormat as string
          if (audioFmt === 'ogg') audioFmt = 'vorbis'
          if (audioFmt === 'wma') audioFmt = 'wav' // converted post-download
          
          ytArgs.push('-x', '--audio-format', audioFmt, '-f', 'bestaudio/best')
          if (task.targetFormat === 'mp3') ytArgs.push('--audio-quality', '0')
        } else if (VIDEO_FORMATS.includes(task.targetFormat as VideoFormat)) {
          ytArgs.push('-f', 'bestvideo+bestaudio/best', '-S', 'res,fps')
          
          let mergeFmt = 'mkv'
          if (['mp4', 'mkv', 'webm', 'ogg', 'flv'].includes(task.targetFormat)) {
            mergeFmt = task.targetFormat
          } else if (task.targetFormat === 'ogv') {
            mergeFmt = 'ogg' // renamed post-download
            ytArgs.push('--recode-video', 'ogg')
          } else if (task.targetFormat === 'm4v') {
            mergeFmt = 'mp4' // renamed post-download
          }
          ytArgs.push('--merge-output-format', mergeFmt)
          
          if (task.targetFormat === 'avi' || task.targetFormat === 'mov') {
            ytArgs.push('--recode-video', task.targetFormat)
          } else if (task.targetFormat === 'gif') {
            // GIF will be converted manually from MP4 in post-download
            ytArgs.push('--merge-output-format', 'mp4')
          }
        }
        break
      }
    }

    // Hide messy temporary parts inside a dedicated hidden temp folder
    const tempDir = path.join(task.directory, '.cortex_temp')
    ytArgs.push('--paths', `temp:${tempDir}`)
    ytArgs.push('--paths', `home:${task.directory}`)
    
    // Set output format to task ID (will be fully renamed post-download)
    ytArgs.push('-o', `${task.id}.%(ext)s`)
    ytArgs.push(task.url)

    return ytArgs
  }

  private async renameDownloaded(task: DownloadTask, detectedFinalPath: string | null): Promise<void> {
    const desiredExt = path.extname(task.filePath) // includes dot
    const safeBase = sanitizeFilename((task.title || task.filename).replace(new RegExp(`${desiredExt}$`), ''))
    const desiredFilename = `${safeBase}${desiredExt || ''}`
    const targetPathBase = path.join(task.directory, desiredFilename)

    // Find a downloaded file if yt-dlp didn't provide a postprocess destination.
    let downloadedPath: string | null = detectedFinalPath
    if (!downloadedPath || !existsSync(downloadedPath)) {
      try {
        const files = await fsPromises.readdir(task.directory)
        downloadedPath = files
          .map((f) => path.join(task.directory, f))
          .find((p) => path.basename(p).startsWith(`${task.id}.`)) ?? null
      } catch {
        downloadedPath = null
      }
    }

    if (!downloadedPath || !existsSync(downloadedPath)) return

    // ── FFMPEG POST-PROCESS FOR UNSUPPORTED FORMATS ──
    const dExt = path.extname(downloadedPath).toLowerCase()
    let needsFfmpeg = false
    let ffmpegArgs: string[] = []

    if (desiredExt === '.gif' && dExt !== '.gif') {
      needsFfmpeg = true
      ffmpegArgs = ['-y', '-threads', '2', '-i', downloadedPath, '-vf', 'fps=15,scale=480:-1:flags=lanczos', downloadedPath.replace(dExt, '.gif')]
    } else if (desiredExt === '.wma' && dExt !== '.wma') {
      needsFfmpeg = true
      ffmpegArgs = ['-y', '-threads', '2', '-i', downloadedPath, '-c:a', 'wmav2', '-b:a', '192k', downloadedPath.replace(dExt, '.wma')]
    }

    if (needsFfmpeg && ffmpegArgs.length > 0) {
      log.info(`[YoutubeEngine] Executing FFMPEG for ${desiredExt} conversion...`)
      const success = await new Promise<boolean>((resolve) => {
        const p = spawn(getBinaryPath('ffmpeg'), ffmpegArgs, { windowsHide: true })
        p.on('close', (code) => resolve(code === 0))
        p.on('error', () => resolve(false))
      })
      if (success) {
        fsPromises.unlink(downloadedPath).catch(() => {})
        downloadedPath = ffmpegArgs[ffmpegArgs.length - 1]
      } else {
        log.warn(`[YoutubeEngine] Failed to convert ${downloadedPath} to ${desiredExt}`)
      }
    }

    // Handle name collisions.
    let targetPath = targetPathBase
    if (existsSync(targetPath)) {
      const parsed = path.parse(targetPathBase)
      let counter = 1
      while (existsSync(`${parsed.dir}\\${parsed.name}_${counter}${parsed.ext}`) && counter < 1000) counter++
      targetPath = `${parsed.dir}\\${parsed.name}_${counter}${parsed.ext}`
    }

    // Windows can sometimes fail to rename if a file is temporarily locked (e.g. by AV or just written). Let's use a small retry loop.
    let renameSuccess = false;
    for (let attempts = 0; attempts < 3; attempts++) {
      try {
        await fsPromises.rename(downloadedPath, targetPath);
        renameSuccess = true;
        break; // Successfully renamed
      } catch (err) {
        log.warn(`[YoutubeEngine] Rename failed on attempt ${attempts + 1} for ${downloadedPath}:`, err);
        await new Promise((r) => setTimeout(r, 1000)); // wait 1s before retrying
      }
    }

    if (!renameSuccess) {
      // If rename fails totally, fall back to updating fields for detected output.
      if (existsSync(downloadedPath)) {
        task.filePath = downloadedPath
        task.filename = path.basename(downloadedPath)
      }
    } else if (existsSync(targetPath)) {
      task.filePath = targetPath
      task.filename = path.basename(targetPath)
    }
  }

  private buildErrorMessage(stderr: string): string {
    const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const errorLine = lines.find(l => /ERROR:/.test(l)) || lines.find(l => /yt-dlp error/i.test(l))
    if (errorLine) return errorLine.replace(/^ERROR:\s*/i, '')
    return (lines.slice(-3).join(' ') || 'yt-dlp failed').trim()
  }
}
