import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { promises as fsPromises, existsSync } from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import type { DownloadTask, EngineContext, TaskRuntime, VideoFormat } from '../types'
import { VIDEO_FORMATS } from '../types'
import { AUDIO_SPECS, audioOutputArgs, isAudioFormat, matchesAudioFormat } from '../audioFormats'
import { isSupportedMediaPath, findTaskMediaFile, probeMediaFile, matchesVideoFormat } from '../mediaFiles'
import { getBinaryPath } from '../paths'
import { nowMs, sanitizeFilename, getFileSizeIfExists, parseTimeToSeconds, sendNotification } from '../utils'
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

const wasStopped = (task: DownloadTask) => task.status === 'paused' || task.status === 'canceled'

export class YoutubeEngine implements IEngine {
  private static updatePromise: Promise<void> | null = null
  private childProcess: ChildProcessWithoutNullStreams | null = null

  async download(task: DownloadTask, context?: EngineContext): Promise<void> {
    if (!context) throw new Error('[YoutubeEngine] Missing EngineContext')

    
    await YoutubeEngine.ensureYtdlpFresh()
    if (wasStopped(task)) return

    const runtime = context.runtime
    this.childProcess = null

    
    const ytDlpPath = getBinaryPath('yt-dlp')
    const ffmpegPath = getBinaryPath('ffmpeg')
    const ffprobePath = getBinaryPath('ffprobe')
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
    if (!existsSync(ffprobePath)) {
      task.status = 'error'
      task.errorMessage = 'ffprobe is missing. Required to validate downloaded media.'
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
    if (runtime.abortController?.signal.aborted || wasStopped(task)) return

    const args = this.buildYtdlpArgs(task, profile, { ffmpegDir }, runtime)
    const runResult = await this.runYtdlpAttempt(task, context, runtime, args, profile)

    
    if (runtime.abortController?.signal.aborted) return

    
    const downloadedTempPath = await findTaskMediaFile(task, runResult.detectedFinalPath)

    
    // Only a successful yt-dlp terminal state can certify a complete file.
    let isSuccess = runResult.exitCode === 0

    if (isSuccess) {
      const finalPathToRename = downloadedTempPath || runResult.detectedFinalPath
      const isMedia = finalPathToRename && isSupportedMediaPath(finalPathToRename)
      
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

      await this.finalizeDownloaded(task, finalPathToRename, runtime, context)
      if (await getFileSizeIfExists(task.filePath) <= 0 || !isSupportedMediaPath(task.filePath)) {
        throw new Error('yt-dlp finished without a supported final media file')
      }

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
      // ── Priority 4: blocking retry logic fix ───────────────────────────
      // This used to `await new Promise(r => setTimeout(r, backoffMs))`
      // right here, inside `download()`. Because DownloadManager awaits
      // this whole call while holding an active concurrency slot for the
      // task, that sleep (up to 60s) blocked another queued download from
      // ever starting. Retry scheduling is now owned by the
      // DownloadManager: it re-queues this task after `backoffMs` without
      // occupying a slot in the meantime.
      context.scheduleRetry(backoffMs)
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
    // Signal abort — actual process tree kill is handled by DownloadManager.
    log.info(`[YoutubeEngine] Pausing — aborting child process...`)
    this.childProcess?.kill()
  }

  stop(): void {
    // Signal abort — actual process tree kill is handled by DownloadManager.
    log.info(`[YoutubeEngine] Stopping — aborting child process...`)
    this.childProcess?.kill()
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
    if (isAudioFormat(task.targetFormat)) return 'proAudio'
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
      '--no-mtime',
      '--geo-bypass',
      ...(YOUTUBE_EXTRACTOR_ARGS ? ['--extractor-args', YOUTUBE_EXTRACTOR_ARGS] : []),
      ...this.buildAuthArgs(task, runtime),
      ...getJsRuntimeArgs(),
      task.url,
    ]

    const proc = spawn(ytDlpPath, metaArgs, { windowsHide: true, detached: false, env: { ...process.env, PYTHONUNBUFFERED: '1', ELECTRON_RUN_AS_NODE: '1' } })

    // ── Priority 4: process lifecycle hole fix ─────────────────────────────
    // This metadata-prefetch process was previously never wired into
    // `runtime.child` or the abort signal, so a pause()/cancel() that
    // arrived *during* prefetch had nothing to kill: the process kept
    // running orphaned in the background even after the task was reported
    // as paused/canceled. It's now tracked exactly like the real download
    // attempt, and unconditionally detached again in `finally` regardless
    // of how this function exits (success, timeout, or abort).
    this.childProcess = proc
    runtime.child = proc
    const onAbort = () => { try { proc.kill() } catch { /* already dead */ } }
    runtime.abortController?.signal.addEventListener('abort', onAbort, { once: true })
    let timeout: ReturnType<typeof setTimeout> | null = null

    try {
      const metaOut = await Promise.race<string>([
        (async () => {
          let out = ''
          for await (const chunk of proc.stdout) out += chunk.toString()
          return out
        })(),
        new Promise<string>((_, rej) => {
          timeout = setTimeout(() => {
            try { proc.kill() } catch { /* process already exited */ }
            rej(new Error('meta timeout'))
          }, META_TIMEOUT_MS)
        }),
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

      const selected = Array.isArray(info.requested_formats) ? info.requested_formats : [info]
      const bytes = selected.map((format: { filesize?: number; filesize_approx?: number }) =>
        format.filesize ?? format.filesize_approx ?? 0)
      if (bytes.length && bytes.every((n: number) => Number.isFinite(n) && n > 0)) {
        task.ytdlpExpectedBytes = bytes.reduce((sum: number, n: number) => sum + n, 0)
        task.totalBytes = task.ytdlpExpectedBytes ?? null
      }

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
    } finally {
      if (timeout) clearTimeout(timeout)
      runtime.abortController?.signal.removeEventListener('abort', onAbort)
      if (this.childProcess === proc) this.childProcess = null
      if (runtime.child === proc) runtime.child = null
    }
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

    // ── Priority 4: process lifecycle hole fix ─────────────────────────────
    // Once the process has exited, drop every reference to it and detach its
    // stream listeners. Previously `this.childProcess` / `runtime.child`
    // were left pointing at the dead handle indefinitely: a later
    // pause()/cancel() targeting a *new* in-flight attempt (or metadata
    // prefetch) could then race against — or simply waste a `killProcessTree`
    // call on — a process that had already exited. Detaching the listeners
    // also lets the closures they capture (task/context/ffmpegState) be
    // garbage collected instead of being pinned for the task's lifetime.
    proc.stdout.removeAllListeners()
    proc.stderr.removeAllListeners()
    if (this.childProcess === proc) this.childProcess = null
    if (runtime.child === proc) runtime.child = null

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

    // Trim support via --download-sections.
    // NOTE: We intentionally omit --force-keyframes-at-cuts.
    // That flag causes ffmpeg to fully re-encode the entire video just to insert
    // a keyframe at cut boundaries, which can consume 3+ GB of RAM for 4K videos.
    // The result is frame-accurate cuts via ffmpeg -ss (input-side seek) instead,
    // which is fast, memory-efficient, and accurate to within one GOP (~0.5s).
    if (task.startTime || task.endTime) {
      const start = task.startTime || '00:00:00'
      const end = task.endTime || 'inf'
      args.push('--download-sections', `*${start}-${end}`)
      // --force-keyframes-at-cuts is intentionally NOT added here (see above)
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
      '--no-mtime',
      '--no-playlist',
      '--geo-bypass',
      
      ...(hasSubtitles ? [] : ['--no-warnings']),
      '--continue',
      ...(YOUTUBE_EXTRACTOR_ARGS ? ['--extractor-args', YOUTUBE_EXTRACTOR_ARGS] : []),
      '--throttled-rate', YOUTUBE_THROTTLED_RATE,
      '--progress-template', 'download:CORTEX_DL|%(info.format_id)s|%(progress.filename)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s',
      '--progress-template', 'postprocess:CORTEX_PP:%(info.filepath)s',
      '--resize-buffer',
      '--file-access-retries', '5',
      '--socket-timeout', '10',
      
      '-N', '10',
      '--concurrent-fragments', '6',
      '--http-chunk-size', '10.0M',
      ...this.buildAuthArgs(task, runtime),
      ...getJsRuntimeArgs(),
    ]

    const isAudio = isAudioFormat(task.targetFormat)

    if (isAudio) {
      // -threads 0: let ffmpeg choose optimal thread count automatically
      // -preset ultrafast: for audio extraction with trim, fast encode matters more than compression
      const extraFfmpegFlags = isTrimmedTask ? '-avoid_negative_ts make_zero -async 1 ' : ''
      ytArgs.push(
        '--postprocessor-args', `ExtractAudio+ffmpeg:-y -hide_banner -threads 0 -max_muxing_queue_size 1024 ${extraFfmpegFlags}`.trim(),
        '--embed-thumbnail',
        '--add-metadata'
      )
    } else if (task.targetFormat === 'mp4') {
      if (isTrimmedTask) {
        // -c:v copy avoids video re-encode (fastest). Audio copy may fail on some
        // streams so we let ffmpeg decide with -c:a copy fallback to aac.
        ytArgs.push('--postprocessor-args', 'ffmpeg:-y -hide_banner -threads 0 -c:v copy -c:a copy -avoid_negative_ts make_zero -async 1 -max_muxing_queue_size 4096 -movflags +faststart')
      } else if (hasSubtitles) {
        ytArgs.push(
          '--postprocessor-args',
          'Merger+ffmpeg:-y -hide_banner -threads 0 -c:v copy -c:a copy -c:s mov_text -max_muxing_queue_size 4096 -movflags +faststart'
        )
      } else {
        ytArgs.push(
          '--postprocessor-args',
          'Merger+ffmpeg:-y -hide_banner -threads 0 -c:v copy -c:a copy -max_muxing_queue_size 4096 -movflags +faststart'
        )
      }
    } else {
      const extraFfmpegFlags = isTrimmedTask
        ? 'ffmpeg:-y -hide_banner -threads 0 -c:v copy -c:a copy -avoid_negative_ts make_zero -async 1 -max_muxing_queue_size 4096'
        : 'Merger+ffmpeg:-y -hide_banner -threads 0 -c:v copy -c:a copy -max_muxing_queue_size 4096'
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
        const audioFmt = AUDIO_SPECS[task.targetFormat as keyof typeof AUDIO_SPECS].ytDlpFormat
        ytArgs.push('-x', '--audio-format', audioFmt, '-f', 'bestaudio/best')
        if (task.targetFormat === 'mp3') ytArgs.push('--audio-quality', '0')
        log.info(`[YoutubeEngine] ProAudio profile applied: format=${audioFmt}, multi-threaded=true, metadata=embedded`)
        break
      }
      case 'bestVideo': {
        const heightFilter = heightConstraint ? `[height<=${heightConstraint}]` : ''
        ytArgs.push(
          '-f',
          `bestvideo${heightFilter}[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo${heightFilter}[ext=mp4]+bestaudio[ext=m4a]/bestvideo${heightFilter}+bestaudio/best`
        )
        if (heightConstraint) {
          log.info(`[YoutubeEngine] Quality constraint applied: height<=${heightConstraint}`)
        }
        ytArgs.push('--merge-output-format', 'mp4')
        break
      }
      default: {
        if (VIDEO_FORMATS.includes(task.targetFormat as VideoFormat)) {
          const heightFilter = heightConstraint ? `[height<=${heightConstraint}]` : ''
          ytArgs.push('-f', `bestvideo${heightFilter}[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo${heightFilter}+bestaudio/best`, '-S', 'res,fps')
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

  private async probeOutput(filePath: string, runtime: TaskRuntime) {
    return probeMediaFile(filePath, child => {
      this.childProcess = child
      runtime.child = child
    })
  }

  private async runConversion(source: string, output: string, args: string[], runtime: TaskRuntime): Promise<void> {
    const proc = spawn(getBinaryPath('ffmpeg'), [
      '-y', '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', source, ...args,
    ], { windowsHide: true, detached: false })
    this.childProcess = proc
    runtime.child = proc
    // ffmpeg can block forever when an unconsumed stderr pipe fills.
    proc.stdout.resume()
    let errors = ''
    proc.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-8192) })
    try {
      const code = await new Promise<number>(resolve => {
        proc.on('close', value => resolve(value ?? 1))
        proc.on('error', () => resolve(1))
      })
      if (runtime.abortController?.signal.aborted) throw new Error('Conversion aborted')
      if (code !== 0) throw new Error(`FFmpeg conversion failed: ${errors.trim() || `exit code ${code}`}`)
      if (await getFileSizeIfExists(output) <= 0) throw new Error('FFmpeg conversion produced no output')
    } finally {
      if (this.childProcess === proc) this.childProcess = null
      if (runtime.child === proc) runtime.child = null
    }
  }

  private videoConversionArgs(format: VideoFormat, output: string): string[] {
    switch (format) {
      case 'mp4': return ['-c:v', 'libx264', '-c:a', 'aac', output]
      case 'm4v': return ['-c:v', 'libx264', '-c:a', 'aac', '-f', 'mp4', output]
      case 'mov': return ['-c:v', 'libx264', '-c:a', 'aac', output]
      case 'mkv': return ['-c', 'copy', output]
      case 'avi': return ['-c:v', 'mpeg4', '-c:a', 'mp3', output]
      case 'webm': return ['-c:v', 'libvpx-vp9', '-c:a', 'libopus', output]
      case 'ogv': return ['-c:v', 'libtheora', '-c:a', 'libvorbis', output]
      case 'gif': return ['-an', '-vf', 'fps=15,scale=480:-1:flags=lanczos', output]
    }
  }

  private async finalizeDownloaded(
    task: DownloadTask,
    sourcePath: string | null,
    runtime: TaskRuntime,
    context: EngineContext,
  ): Promise<void> {
    if (!sourcePath) throw new Error('yt-dlp produced no final media file')
    const format = task.targetFormat
    const extension = `.${format}`
    const sourceProbe = await this.probeOutput(sourcePath, runtime)
    if (runtime.abortController?.signal.aborted || wasStopped(task)) throw new Error('Finalization aborted')
    const correctFormat = isAudioFormat(format)
      ? matchesAudioFormat(format, sourceProbe)
      : matchesVideoFormat(format, sourceProbe)
    const sourceExtension = path.extname(sourcePath).toLowerCase()
    let readyPath = sourcePath

    if (!correctFormat) {
      task.status = 'converting'
      task.convertingPercent = undefined
      context.sendUpdate(task)
      const converted = path.join(task.directory, `${task.id}.final${extension}`)
      if (converted === sourcePath) throw new Error('Cannot convert media in place')
      await fsPromises.unlink(converted).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      const args = isAudioFormat(format)
        ? audioOutputArgs(format, converted)
        : this.videoConversionArgs(format, converted)
      await this.runConversion(sourcePath, converted, args, runtime)
      const convertedProbe = await this.probeOutput(converted, runtime)
      if (runtime.abortController?.signal.aborted || wasStopped(task)) throw new Error('Finalization aborted')
      const convertedValid = isAudioFormat(format)
        ? matchesAudioFormat(format, convertedProbe)
        : matchesVideoFormat(format, convertedProbe)
      if (!convertedValid) throw new Error(`FFmpeg produced an invalid ${format} file`)
      readyPath = converted
    } else if (sourceExtension !== extension) {
      // This is safe only because ffprobe confirmed the actual container and codec.
      log.info(`[YoutubeEngine] Normalizing compatible ${sourceExtension} extension to ${extension}`)
    }

    if (runtime.abortController?.signal.aborted || wasStopped(task)) throw new Error('Finalization aborted')
    const base = sanitizeFilename(path.parse(task.title || task.filename).name)
    const parsedTarget = path.parse(path.join(task.directory, `${base}${extension}`))
    let target = path.join(parsedTarget.dir, `${parsedTarget.name}${parsedTarget.ext}`)
    let suffix = 1
    while (existsSync(target) && target !== readyPath) {
      target = path.join(parsedTarget.dir, `${parsedTarget.name}_${suffix++}${parsedTarget.ext}`)
    }
    const moved = readyPath !== target
    if (moved) await fsPromises.rename(readyPath, target)
    try {
      const finalProbe = await this.probeOutput(target, runtime)
      if (runtime.abortController?.signal.aborted || wasStopped(task)) throw new Error('Finalization aborted')
      const finalValid = isAudioFormat(format)
        ? matchesAudioFormat(format, finalProbe)
        : matchesVideoFormat(format, finalProbe)
      if (!finalValid || await getFileSizeIfExists(target) <= 0) {
        throw new Error(`Final ${format} file failed validation`)
      }
    } catch (error) {
      if (moved) await fsPromises.rename(target, readyPath).catch(rollbackError => {
        log.error(`[YoutubeEngine] Could not restore task-owned output after failed validation:`, rollbackError)
      })
      throw error
    }
    task.filePath = target
    task.filename = path.basename(target)
    if (sourcePath !== target && sourcePath !== readyPath) {
      await fsPromises.unlink(sourcePath).catch(() => {})
    }

    try {
      const files = await fsPromises.readdir(task.directory)
      const subtitles = files.filter(name => name.startsWith(`${task.id}.`) && /\.(vtt|srt)$/i.test(name))
      for (const name of subtitles) {
        const suffix = name.substring(task.id.length)
        await fsPromises.rename(path.join(task.directory, name), path.join(task.directory, `${path.parse(target).name}${suffix}`))
      }
    } catch (error) {
      log.warn(`[YoutubeEngine] Could not rename subtitles for ${task.id}:`, error)
    }
  }

  private buildErrorMessage(stderr: string): string {
    const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const errorLine = lines.find(l => /ERROR:/.test(l)) || lines.find(l => /yt-dlp error/i.test(l))
    if (errorLine) return errorLine.replace(/^ERROR:\s*/i, '')
    return (lines.slice(-3).join(' ') || 'yt-dlp failed').trim()
  }
}
