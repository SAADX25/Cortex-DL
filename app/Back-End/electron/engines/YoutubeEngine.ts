import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { promises as fsPromises, existsSync } from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import type { DownloadTask, EngineContext, TaskRuntime, AudioFormat, VideoFormat } from '../types'
import { AUDIO_FORMATS, VIDEO_FORMATS } from '../types'
import { getBinaryPath } from '../paths'
import { nowMs, sanitizeFilename, getFileSizeIfExists, parseTimeToSeconds, sendNotification, killProcessTree } from '../utils'
import {
  parseDownloadProgress,
  parseFfmpegProgress,
  parseStateTransition,
  flushLines,
  logRawProgressChunk,
} from '../progressParser'
import type { FfmpegState } from '../progressParser'
import type { IEngine } from './IEngine'
import { getJsRuntimeArgs, getYtdlpCookieArgs, YOUTUBE_EXTRACTOR_ARGS } from '../ytdlp'
import { isYouTubeAuthRequiredError, YOUTUBE_AUTH_REQUIRED_CODE } from '../ytdlp'

type Profile = 'proAudio' | 'bestVideo' | 'default'

const YOUTUBE_THROTTLED_RATE = '512K'

interface YtdlpRunResult {
  exitCode: number
  detectedFinalPath: string | null
  stderr: string
}

export class YoutubeEngine implements IEngine {
  private static updatePromise: Promise<void> | null = null
  private childProcess: ChildProcessWithoutNullStreams | null = null

  async download(task: DownloadTask, context?: EngineContext): Promise<void> {
    if (!context) throw new Error('[YoutubeEngine] Missing EngineContext')

    
    await YoutubeEngine.ensureYtdlpFresh()

    const runtime = context.runtime
    this.childProcess = null

    
    const ytDlpPath = getBinaryPath('yt-dlp')
    const ffmpegPath = getBinaryPath('ffmpeg')
    const ffmpegDir = path.dirname(ffmpegPath)

    const profile = this.selectProfile(task)
    const isTrimmedTask = Boolean(task.startTime || task.endTime)
    const requiresFfmpeg = isTrimmedTask || profile === 'proAudio' || profile === 'bestVideo' || task.targetFormat !== 'webm'
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

    
    runtime.abortController?.abort()
    runtime.abortController = new AbortController()
    runtime.lastSpeedSampleAtMs = null
    runtime.lastSpeedSampleBytes = null
    runtime.retries = runtime.retries ?? 0

    
    task.status = 'downloading'
    task.errorMessage = null
    task.updatedAtMs = nowMs()
    context.sendUpdate(task)

    
    await this.prefetchMetadata(task, context, runtime).catch((e) => {
      
      log.warn(`[YoutubeEngine] Metadata prefetch failed for ${task.id}:`, e instanceof Error ? e.message : e)
    })

    const args = this.buildYtdlpArgs(task, profile, { ffmpegDir }, runtime)
    const runResult = await this.runYtdlpAttempt(task, context, runtime, args, profile)

    
    if (runtime.abortController?.signal.aborted) return

    
    let downloadedTempPath: string | null = runResult.detectedFinalPath
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

    
    let isSuccess = runResult.exitCode === 0
    if (!isSuccess && downloadedTempPath && existsSync(downloadedTempPath)) {
      const sizeTemp = await getFileSizeIfExists(downloadedTempPath)
      const isMedia = /\.(mp4|mkv|webm|mp3|m4a|ogg|wav|flv|avi|mov)$/i.test(downloadedTempPath)
      
      
      if (isMedia && sizeTemp > 50 * 1024) {
        log.warn(`[YoutubeEngine] Task ${task.id} exited with ${runResult.exitCode} but generated valid media file. Treating as success.`)
        isSuccess = true
      }
    }

    if (isSuccess) {
      const finalPathToRename = downloadedTempPath || runResult.detectedFinalPath
      const isMedia = finalPathToRename && /\.(mp4|mkv|webm|mp3|m4a|ogg|wav|flv|avi|mov)$/i.test(finalPathToRename)
      
      if (!isMedia) {
        log.error(`[YoutubeEngine] Task ${task.id} exited with 0 but no valid media file was found (found: ${finalPathToRename}). The download was likely blocked by YouTube.`)
        
        
        try {
          const files = await fsPromises.readdir(task.directory)
          const fragments = files.filter(f => f.startsWith(`${task.id}.`))
          for (const f of fragments) {
            await fsPromises.unlink(path.join(task.directory, f)).catch(() => {})
          }
        } catch (e) {
          log.warn(`[YoutubeEngine] Failed to clean up fragments for ${task.id}`, e)
        }

        if (!runtime.ignoreCookies && args.includes('--cookies')) {
          log.warn(`[YoutubeEngine] Retrying task ${task.id} without cookies due to missing valid media file...`)
          runtime.ignoreCookies = true
          isSuccess = false
        } else {
          task.status = 'error'
          task.errorMessage = `Download failed: No video file was generated. YouTube might have blocked the download.`
          task.updatedAtMs = nowMs()
          runtime.retries = 0
          context.flushSave()
          context.sendUpdate(task)
          sendNotification('Download Failed', `YouTube blocked the download.`)
          return
        }
      }

      if (isSuccess) {

      await this.renameDownloaded(task, finalPathToRename)

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
    }

    
    if (isYouTubeAuthRequiredError(runResult.stderr)) {
      log.warn(`[YoutubeEngine] Authentication or rate limit required for task ${task.id}`)
      
      if (!runtime.ignoreCookies && args.includes('--cookies')) {
        log.warn(`[YoutubeEngine] Retrying task ${task.id} without cookies to bypass auth limit...`)
        runtime.ignoreCookies = true
        
      } else {
        task.status = 'error'
        task.errorMessage = YOUTUBE_AUTH_REQUIRED_CODE
        task.updatedAtMs = nowMs()
        runtime.retries = 0
        context.flushSave()
        context.sendUpdate(task)
        sendNotification('YouTube Sign-in Required', 'Add a valid YouTube cookies.txt file in Settings.')
        return
      }
    }

    const finalMessage = this.buildErrorMessage(runResult.stderr)
    log.error(`[YoutubeEngine] Task ${task.id} exited with code ${runResult.exitCode}: ${finalMessage}`)

    
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
    if (AUDIO_FORMATS.includes(task.targetFormat as AudioFormat)) return 'proAudio'
    if (task.targetFormat === 'mp4') return 'bestVideo'
    return 'default'
  }

  private computePreseedDuration(task: DownloadTask): number | null {
    if (task.startTime && task.endTime) {
      const td = parseTimeToSeconds(task.endTime) - parseTimeToSeconds(task.startTime)
      if (td > 0) return td
    } else if (!task.startTime && task.endTime) {
      const endSec = parseTimeToSeconds(task.endTime)
      if (endSec > 0) return endSec
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
      '--extractor-args', YOUTUBE_EXTRACTOR_ARGS,
      ...this.buildAuthArgs(task, runtime),
      ...getJsRuntimeArgs(),
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
          try { proc.kill() } catch {
            
          }
          rej(new Error('meta timeout'))
        }, META_TIMEOUT_MS)
      ),
    ])

    if (!metaOut || runtime.abortController?.signal.aborted) return

    let info: any = null
    try {
      info = JSON.parse(metaOut.trim())
    } catch {
      
      const start = metaOut.indexOf('{')
      const end = metaOut.lastIndexOf('}')
      if (start >= 0 && end > start) info = JSON.parse(metaOut.slice(start, end + 1))
    }

    if (!info) return

    if (info.title) task.title = String(info.title)

    
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

  private async runYtdlpAttempt(
    task: DownloadTask,
    context: EngineContext,
    runtime: TaskRuntime,
    args: string[],
    profile: Profile,
  ): Promise<YtdlpRunResult> {
    const proc = spawn(getBinaryPath('yt-dlp'), args, {
      windowsHide: true,
      detached: false,
      env: { ...process.env, PYTHONUNBUFFERED: '1', ELECTRON_RUN_AS_NODE: '1' },
    })

    this.childProcess = proc
    runtime.child = proc

    const hasCookies = args.includes('--cookies')
    log.info(`[YoutubeEngine] Spawned yt-dlp for task ${task.id} (profile=${profile}${hasCookies ? ', cookies=active' : ''})`)

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
      logRawProgressChunk(task.id, 'yt-dlp:stderr', chunk)

      ffmpegState.stderr += chunk
      if (ffmpegState.stderr.length > MAX_STDERR_BYTES) {
        ffmpegState.stderr = ffmpegState.stderr.slice(-MAX_STDERR_BYTES)
      }

      let lines: string[]
      ;[lines, stderrBuf] = flushLines(stderrBuf, chunk)

      for (const line of lines) {
        if (!line.trim()) continue

        
        if (/subtitle|sub|embed|caption|WARNING|ERROR/i.test(line)) {
          log.info(`[YoutubeEngine:sub] ${line.trim()}`)
        }

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
      const chunk = data.toString()
      logRawProgressChunk(task.id, 'yt-dlp:stdout', chunk)

      let lines: string[]
      ;[lines, stdoutBuf] = flushLines(stdoutBuf, chunk)

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

    return { exitCode, detectedFinalPath, stderr: ffmpegState.stderr }
  }

  private buildAuthArgs(task: DownloadTask, runtime: TaskRuntime): string[] {
    const args: string[] = []

    if (!runtime.ignoreCookies) {
      args.push(...getYtdlpCookieArgs())
    }

    
    if (task.username) args.push('--username', task.username)
    if (task.password) args.push('--password', task.password)

    if (task.speedLimit && task.speedLimit !== 'auto') args.push('--limit-rate', task.speedLimit)

    
    if (task.startTime || task.endTime) {
      const start = task.startTime || '00:00:00'
      const end = task.endTime || 'inf'
      args.push('--download-sections', `*${start}-${end}`)
      args.push('--force-keyframes-at-cuts')
    }

    return args
  }

  private parseHeightFromFormatId(formatId: string | undefined | null): number | null {
    if (!formatId) return null
    const match = /^(\d{3,4})p$/i.exec(formatId.trim())
    if (!match) return null
    const height = parseInt(match[1], 10)
    return isNaN(height) ? null : height
  }

  private buildYtdlpArgs(
    task: DownloadTask,
    profile: Profile,
    opts: { ffmpegDir: string },
    runtime: TaskRuntime,
  ): string[] {
    const hasSubtitles = task.subtitleLanguage && VIDEO_FORMATS.includes(task.targetFormat as VideoFormat)
    const isTrimmedTask = Boolean(task.startTime || task.endTime)

    const ytArgs: string[] = [
      '--newline',
      '--progress',
      '--no-check-certificate',
      '--no-mtime',
      '--no-playlist',
      '--geo-bypass',
      '--force-ipv4',
      
      ...(hasSubtitles ? [] : ['--no-warnings']),
      '--force-overwrites',
      '--extractor-args', YOUTUBE_EXTRACTOR_ARGS,
      '--throttled-rate', YOUTUBE_THROTTLED_RATE,
      '--progress-template', 'download:CORTEX_DL:%(progress.downloaded_bytes)s:%(progress.total_bytes_estimate)s:%(progress.speed)s',
      '--progress-template', 'postprocess:CORTEX_PP:%(info.filepath)s',
      '--resize-buffer',
      '--file-access-retries', '5',
      '--socket-timeout', '10',
      
      '-N', '8',
      '--concurrent-fragments', '4',
      '--http-chunk-size', '5.0M',
      ...this.buildAuthArgs(task, runtime),
      ...getJsRuntimeArgs(),
    ]

    const isAudio = AUDIO_FORMATS.includes(task.targetFormat as AudioFormat)

    if (isAudio) {
      const extraFfmpegFlags = isTrimmedTask ? '-avoid_negative_ts make_zero -async 1 ' : ''
      ytArgs.push(
        '--postprocessor-args', `ExtractAudio+ffmpeg:-y -threads 2 -max_muxing_queue_size 1024 ${extraFfmpegFlags}`.trim(),
        '--embed-thumbnail',
        '--add-metadata'
      )
    } else if (task.targetFormat === 'mp4') {
      if (isTrimmedTask) {
        ytArgs.push('--postprocessor-args', 'ffmpeg:-y -threads 2 -c:v copy -avoid_negative_ts make_zero -async 1 -max_muxing_queue_size 1024 -movflags +faststart')
      } else if (hasSubtitles) {
        ytArgs.push(
          '--postprocessor-args',
          'Merger+ffmpeg:-y -threads 2 -c:v copy -c:a aac -c:s mov_text -max_muxing_queue_size 1024 -movflags +faststart'
        )
      } else {
        ytArgs.push(
          '--postprocessor-args',
          'Merger+ffmpeg:-y -threads 2 -c:v copy -c:a aac -max_muxing_queue_size 1024 -movflags +faststart'
        )
      }
    } else {
      const extraFfmpegFlags = isTrimmedTask ? 'ffmpeg:-y -threads 2 -c:v copy -avoid_negative_ts make_zero -async 1 -max_muxing_queue_size 1024' : 'Merger+ffmpeg:-y -threads 2 -c:v copy -max_muxing_queue_size 1024'
      ytArgs.push('--postprocessor-args', extraFfmpegFlags)
    }

    const ffmpegExePath = getBinaryPath('ffmpeg')
    if (existsSync(ffmpegExePath)) ytArgs.push('--ffmpeg-location', opts.ffmpegDir)

    if (hasSubtitles) {
      ytArgs.push(task.subtitleIsAutomatic ? '--write-auto-subs' : '--write-subs')
      ytArgs.push('--sub-langs', task.subtitleLanguage!)
      ytArgs.push('--embed-subs')
      log.info(`[YoutubeEngine] Subtitle args: lang=${task.subtitleLanguage}, auto=${task.subtitleIsAutomatic}, embedded=true`)
    }

    const heightConstraint = this.parseHeightFromFormatId(task.ytdlpFormatId)

    switch (profile) {
      case 'proAudio': {
        let audioFmt = task.targetFormat as string
        if (audioFmt === 'ogg') audioFmt = 'vorbis'
        if (audioFmt === 'wma') audioFmt = 'wav'

        ytArgs.push('-x', '--audio-format', audioFmt, '-f', 'bestaudio/best')
        if (task.targetFormat === 'mp3') ytArgs.push('--audio-quality', '0')
        log.info(`[YoutubeEngine] ProAudio profile applied: format=${audioFmt}, multi-threaded=true, metadata=embedded`)
        break
      }
      case 'bestVideo': {
        const heightFilter = heightConstraint ? `[height<=${heightConstraint}]` : ''
        ytArgs.push(
          '-f',
          `bestvideo${heightFilter}[ext=mp4]+bestaudio[ext=m4a]/bestvideo${heightFilter}+bestaudio/best`
        )
        if (heightConstraint) {
          log.info(`[YoutubeEngine] Quality constraint applied: height<=${heightConstraint}`)
        }
        ytArgs.push('--merge-output-format', 'mp4')
        break
      }
      default: {
        if (AUDIO_FORMATS.includes(task.targetFormat as AudioFormat)) {
          let audioFmt = task.targetFormat as string
          if (audioFmt === 'ogg') audioFmt = 'vorbis'
          if (audioFmt === 'wma') audioFmt = 'wav'

          ytArgs.push('-x', '--audio-format', audioFmt, '-f', 'bestaudio/best')
          if (task.targetFormat === 'mp3') ytArgs.push('--audio-quality', '0')
        } else if (VIDEO_FORMATS.includes(task.targetFormat as VideoFormat)) {
          const heightFilter = heightConstraint ? `[height<=${heightConstraint}]` : ''
          ytArgs.push('-f', `bestvideo${heightFilter}+bestaudio/best`, '-S', 'res,fps')
          if (heightConstraint) {
            log.info(`[YoutubeEngine] Quality constraint applied (default): height<=${heightConstraint}`)
          }

          let mergeFmt = 'mkv'
          if (['mp4', 'mkv', 'webm', 'ogg', 'flv'].includes(task.targetFormat)) {
            mergeFmt = task.targetFormat
          } else if (task.targetFormat === 'ogv') {
            mergeFmt = 'ogg'
            ytArgs.push('--recode-video', 'ogg')
          } else if (task.targetFormat === 'm4v') {
            mergeFmt = 'mp4'
          }
          ytArgs.push('--merge-output-format', mergeFmt)

          if (task.targetFormat === 'avi' || task.targetFormat === 'mov') {
            ytArgs.push('--recode-video', task.targetFormat)
          } else if (task.targetFormat === 'gif') {
            ytArgs.push('--merge-output-format', 'mp4')
          }
        }
        break
      }
    }

    
    const tempDir = path.join(task.directory, '.cortex_temp')
    ytArgs.push('--paths', `temp:${tempDir}`)
    ytArgs.push('--paths', `home:${task.directory}`)
    
    
    ytArgs.push('-o', `${task.id}.%(ext)s`)
    ytArgs.push(task.url)

    return ytArgs
  }

  private async renameDownloaded(task: DownloadTask, detectedFinalPath: string | null): Promise<void> {
    const desiredExt = path.extname(task.filePath) 
    const safeBase = sanitizeFilename((task.title || task.filename).replace(new RegExp(`${desiredExt}$`), ''))
    const desiredFilename = `${safeBase}${desiredExt || ''}`
    const targetPathBase = path.join(task.directory, desiredFilename)

    
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

    
    let targetPath = targetPathBase
    if (existsSync(targetPath)) {
      const parsed = path.parse(targetPathBase)
      let counter = 1
      while (existsSync(`${parsed.dir}\\${parsed.name}_${counter}${parsed.ext}`) && counter < 1000) counter++
      targetPath = `${parsed.dir}\\${parsed.name}_${counter}${parsed.ext}`
    }

    
    let renameSuccess = false;
    for (let attempts = 0; attempts < 3; attempts++) {
      try {
        await fsPromises.rename(downloadedPath, targetPath);
        renameSuccess = true;
        break; 
      } catch (err) {
        log.warn(`[YoutubeEngine] Rename failed on attempt ${attempts + 1} for ${downloadedPath}:`, err);
        await new Promise((r) => setTimeout(r, 1000)); 
      }
    }

    if (!renameSuccess) {
      if (existsSync(downloadedPath)) {
        task.filePath = downloadedPath
        task.filename = path.basename(downloadedPath)
      }
    } else if (existsSync(targetPath)) {
      task.filePath = targetPath
      task.filename = path.basename(targetPath)

      
      try {
        const files = await fsPromises.readdir(task.directory)
        const subFiles = files.filter(f => f.startsWith(`${task.id}.`) && (f.endsWith('.vtt') || f.endsWith('.srt')))
        const parsedTarget = path.parse(targetPath)
        
        for (const subFile of subFiles) {
          const oldSubPath = path.join(task.directory, subFile)
          
          const suffix = subFile.substring(task.id.length)
          const newSubPath = path.join(task.directory, `${parsedTarget.name}${suffix}`)
          await fsPromises.rename(oldSubPath, newSubPath)
        }
      } catch (err) {
        log.error('[YoutubeEngine] Failed to rename subtitle files:', err)
      }
    }
  }

  private buildErrorMessage(stderr: string): string {
    const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const errorLine = lines.find(l => /ERROR:/.test(l)) || lines.find(l => /yt-dlp error/i.test(l))
    if (errorLine) return errorLine.replace(/^ERROR:\s*/i, '')
    return (lines.slice(-3).join(' ') || 'yt-dlp failed').trim()
  }
}
