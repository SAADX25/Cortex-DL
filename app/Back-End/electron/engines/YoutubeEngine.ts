// yt-dlp download engine for YouTube and other supported sites, with Threads delegation and HLS fallback.
import { ensureEnginesReady, engineExecutionFailed } from './engineManager'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import log from 'electron-log'
import {
  type DownloadTask,
  type EngineContext,
  type TaskRuntime,
  type VideoFormat,
  type EngineResult,
  VIDEO_FORMATS,
} from '../types'
import { AUDIO_SPECS, isAudioFormat, findTaskMediaFile, trimBounds } from '../services/mediaService'
import { getBinaryPath } from '../paths'
import { nowMs, killProcessTree } from '../utils'
import {
  parseDownloadProgress,
  parseFfmpegProgress,
  parseStateTransition,
  flushLines,
  type FfmpegState,
} from '../progressParser'
import { type IEngine } from './IEngine'
import { ThreadsEngine } from './ThreadsEngine'
import {
  checkJsRuntime,
  getJsRuntimeArgs,
  diagnosticCategories,
  youtubeDiagnostic,
} from './ytdlpService'
import { isYouTubeUrl, youtubeErrorCode } from '../../../Shared/youtubeErrors'
import { isKickUrl, isThreadsUrl } from '../../../Shared/analysisUrl'

type Profile = 'proAudio' | 'bestVideo' | 'default'

const YOUTUBE_THROTTLED_RATE = '512K'
// Pre-roll adaptive audio before the cut start on Fast Cut so it covers any preceding video keyframe (typically 2-5s GOP) with zero silence.
const FAST_CUT_AUDIO_PREROLL_SECONDS = 12

function formatSectionSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(3)
}

function fastCutAudioPrerollStart(
  task: Pick<DownloadTask, 'targetFormat' | 'trimMode' | 'isLive'>,
  sectionBounds?: { start: number; end?: number } | null,
): number | null {
  if (!sectionBounds || sectionBounds.start <= 0) return null
  if (
    task.trimMode === 'exact' ||
    task.isLive ||
    isAudioFormat(task.targetFormat) ||
    task.targetFormat === 'gif'
  )
    return null
  return Math.max(0, sectionBounds.start - FAST_CUT_AUDIO_PREROLL_SECONDS)
}

interface YtdlpRunResult {
  exitCode: number
  detectedFinalPath: string | null
  stderr: string
}

export class YoutubeEngine implements IEngine {
  private runtime: TaskRuntime | null = null
  private childProcess: ChildProcessWithoutNullStreams | null = null
  private activeDelegate: IEngine | null = null

  async download(task: DownloadTask, context?: EngineContext): Promise<EngineResult> {
    // Threads bypasses yt-dlp and uses the native HTML/DASH extractor in ThreadsEngine.
    if (isThreadsUrl(task.url)) {
      const delegate = new ThreadsEngine()
      this.activeDelegate = delegate
      this.runtime = context?.runtime ?? null
      try {
        return await delegate.download(task, context)
      } finally {
        if (this.activeDelegate === delegate) this.activeDelegate = null
      }
    }
    await ensureEnginesReady(['yt-dlp', 'deno', 'ffmpeg', 'ffprobe'])
    await checkJsRuntime()
    if (!context) throw new Error('[YoutubeEngine] Missing EngineContext')
    const runtime = context.runtime
    this.runtime = runtime
    runtime.abortController ??= new AbortController()
    runtime.abortController.signal.throwIfAborted()
    if (!existsSync(getBinaryPath('yt-dlp')))
      return { kind: 'fatal-error', message: 'yt-dlp binary is missing' }
    task.ytdlpExpectedBytes = undefined
    task.ytdlpExpectedStreamCount = undefined
    task.ytdlpStreams = undefined
    task.totalBytes = null
    task.downloadedBytes = 0
    const profile = this.selectProfile(task)
    const publicFirst = isYouTubeUrl(task.url)
    const trimming = Boolean(task.startTime || task.endTime)
    const sectionBounds = trimming ? trimBounds(task) : null
    if (trimming) {
      task.phase = 'trimming'
      context.sendUpdate(task)
    }
    if ((!task.title || !task.thumbnail) && !task.isLive)
      await this.prefetchMetadata(task, context, runtime).catch(e =>
        log.warn('[YoutubeEngine] Metadata:', e),
      )
    runtime.abortController.signal.throwIfAborted()
    const args = this.buildYtdlpArgs(
      task,
      profile,
      { ffmpegDir: path.dirname(getBinaryPath('ffmpeg')) },
      runtime,
    )
    let result = await this.runYtdlpAttempt(task, context, runtime, args, profile, sectionBounds)
    runtime.abortController.signal.throwIfAborted()

    // YouTube occasionally 403s HTTPS/DASH fragments on public sessions; retry with m3u8/HLS before failing.
    if (
      publicFirst &&
      result.exitCode !== 0 &&
      /HTTP Error 403/i.test(result.stderr) &&
      !youtubeErrorCode(result.stderr)
    ) {
      const hlsArgs = this.buildYtdlpArgs(
        task,
        profile,
        { ffmpegDir: path.dirname(getBinaryPath('ffmpeg')) },
        runtime,
        true,
      )
      result = await this.runYtdlpAttempt(task, context, runtime, hlsArgs, profile, sectionBounds)
    }
    runtime.abortController.signal.throwIfAborted()
    if (result.exitCode === 0) {
      const candidate = await findTaskMediaFile(task, result.detectedFinalPath)
      runtime.abortController.signal.throwIfAborted()
      if (candidate)
        return { kind: 'success', candidate, ...(trimming ? { sectionTrimmed: true } : {}) }
      return { kind: 'fatal-error', message: 'yt-dlp produced no final media file' }
    }
    const youtubeFailure = publicFirst ? youtubeErrorCode(result.stderr) : null
    if (youtubeFailure) {
      if (youtubeFailure === 'YOUTUBE_NETWORK_ERROR') {
        return {
          kind: 'retryable-error',
          message: youtubeFailure,
          delayMs: Math.min(3000 * 2 ** runtime.retries, 60000),
        }
      }
      return { kind: 'fatal-error', message: youtubeFailure }
    }
    if (publicFirst && /HTTP (?:Error )?403/i.test(result.stderr))
      return { kind: 'fatal-error', message: 'YOUTUBE_FORMATS_RESTRICTED' }
    return {
      kind: 'retryable-error',
      message: this.buildErrorMessage(result.stderr),
      delayMs: Math.min(3000 * 2 ** runtime.retries, 60000),
    }
  }

  pause(): void {
    log.info(`[YoutubeEngine] Pausing — aborting child process...`)
    this.activeDelegate?.pause()
    this.runtime?.abortController?.abort()
  }

  stop(): void {
    log.info(`[YoutubeEngine] Stopping — aborting child process...`)
    this.activeDelegate?.stop()
    this.runtime?.abortController?.abort()
  }

  private selectProfile(task: DownloadTask): Profile {
    if (isAudioFormat(task.targetFormat)) return 'proAudio'
    if (task.targetFormat === 'mp4') return 'bestVideo'
    return 'default'
  }

  private async prefetchMetadata(
    task: DownloadTask,
    context: EngineContext,
    runtime: TaskRuntime,
  ): Promise<void> {
    const ytDlpPath = getBinaryPath('yt-dlp')

    // Reuse the exact -f/-S selectors so expected byte counts match the streams yt-dlp will actually fetch.
    const selection = this.buildYtdlpArgs(
      task,
      this.selectProfile(task),
      { ffmpegDir: path.dirname(getBinaryPath('ffmpeg')) },
      runtime,
    )
    const selectorArgs: string[] = []
    for (const flag of ['-f', '-S']) {
      const index = selection.indexOf(flag)
      if (index >= 0) selectorArgs.push(flag, selection[index + 1])
    }
    const META_TIMEOUT_MS = 15_000
    const metaArgs = [
      '--dump-json',
      ...selectorArgs,
      '--ignore-config',
      '--no-playlist',
      '--no-mtime',
      '--geo-bypass',

      ...this.buildAuthArgs(task, runtime),
      ...getJsRuntimeArgs(),
      task.url,
    ]

    const proc = spawn(ytDlpPath, metaArgs, {
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, PYTHONUNBUFFERED: '1', ELECTRON_RUN_AS_NODE: '1' },
    })

    this.childProcess = proc
    runtime.child = proc
    const onAbort = () => {
      void killProcessTree(proc)
    }
    runtime.abortController?.signal.addEventListener('abort', onAbort, { once: true })
    proc.stderr.resume()
    const closed = new Promise<void>(resolve => {
      proc.on('close', () => resolve())
      proc.on('error', () => resolve())
    })
    let timeout: ReturnType<typeof setTimeout> | null = null

    try {
      const metaOut = await Promise.race<string>([
        (async () => {
          let out = ''
          for await (const chunk of proc.stdout) {
            out += chunk.toString()
            if (out.length > 8 * 1024 * 1024) throw new Error('Metadata output exceeds limit')
          }
          return out
        })(),
        new Promise<string>((_, rej) => {
          timeout = setTimeout(() => {
            void killProcessTree(proc)
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
      const trimming = Boolean(task.startTime || task.endTime)
      if (!trimming) {
        task.ytdlpExpectedStreamCount = selected.length
        const bytes = selected.map(
          (format: { filesize?: number; filesize_approx?: number }) =>
            format.filesize ?? format.filesize_approx ?? 0,
        )
        if (bytes.length && bytes.every((n: number) => Number.isFinite(n) && n > 0)) {
          task.ytdlpExpectedBytes = bytes.reduce((sum: number, n: number) => sum + n, 0)
          task.totalBytes = task.ytdlpExpectedBytes ?? null
        }
      }

      if (info.title) task.title = String(info.title)
      if (info.is_live === true || info.live_status === 'is_live') task.isLive = true

      if (typeof info.duration === 'number') {
        log.info(`[YoutubeEngine] Duration for ${task.id}: ${info.duration}s`)
      }

      const thumbs = Array.isArray(info.thumbnails) ? info.thumbnails : null
      const thumb =
        info.thumbnail ?? (thumbs && thumbs.length ? thumbs[thumbs.length - 1]?.url : null)

      if (thumb) task.thumbnail = String(thumb)

      task.updatedAtMs = nowMs()
      context.sendUpdate(task)
    } finally {
      if (timeout) clearTimeout(timeout)
      await killProcessTree(proc)
      await closed
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
    sectionBounds?: { start: number; end?: number } | null,
  ): Promise<YtdlpRunResult> {
    const proc = spawn(getBinaryPath('yt-dlp'), args, {
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, PYTHONUNBUFFERED: '1', ELECTRON_RUN_AS_NODE: '1' },
    })

    this.childProcess = proc
    runtime.child = proc

    const onAbort = () => {
      void killProcessTree(proc)
    }
    runtime.abortController?.signal.addEventListener('abort', onAbort, { once: true })
    if (runtime.abortController?.signal.aborted) onAbort()

    log.info(`[YoutubeEngine] Spawned yt-dlp for task ${task.id} (profile=${profile})`)

    // FFmpeg reports elapsed clip time starting at 00:00:00 even with -copyts, so track the clip duration directly.
    const expectedSectionDuration =
      sectionBounds?.end !== undefined
        ? Math.max(0.1, sectionBounds.end - sectionBounds.start)
        : null
    const ffmpegState: FfmpegState = {
      totalDuration: expectedSectionDuration,
      ...(sectionBounds && sectionBounds.start > 0 ? { sectionStart: sectionBounds.start } : {}),
      stderr: '',
    }
    let stdoutBuf = ''
    let stderrBuf = ''
    let lastUpdateAtMs = 0
    let detectedFinalPath: string | null = null

    const progressCtx = {
      sendUpdate: (t: DownloadTask) => context.sendUpdate(t),
      saveState: () => context.saveState(),
    }

    // Section cuts, livestreams, and Kick VODs can pause silently while seeking or buffering fragments.
    const stallLimitMs = sectionBounds || task.isLive || isKickUrl(task.url) ? 180_000 : 90_000
    let lastActivity = nowMs()
    let stalled = false
    const watchdog = setInterval(() => {
      if (nowMs() - lastActivity >= stallLimitMs && !stalled) {
        stalled = true
        ffmpegState.stderr += `\nERROR: Download stalled with no progress for ${Math.round(stallLimitMs / 1000)}s`
        void killProcessTree(proc)
      }
    }, 5000)
    watchdog.unref?.()
    const MAX_STDERR_BYTES = 64 * 1024

    proc.stderr.on('data', (data: Buffer) => {
      if (runtime.abortController?.signal.aborted) return
      lastActivity = nowMs()
      const chunk = data.toString()

      ffmpegState.stderr += chunk
      if (ffmpegState.stderr.length > MAX_STDERR_BYTES) {
        ffmpegState.stderr = ffmpegState.stderr.slice(-MAX_STDERR_BYTES)
      }

      let lines: string[]
      ;[lines, stderrBuf] = flushLines(stderrBuf, chunk)

      for (const line of lines) {
        if (!line.trim()) continue

        if (/subtitle|sub|embed|caption|WARNING|ERROR/i.test(line)) {
          youtubeDiagnostic('extractor', { categories: diagnosticCategories(line) })
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
      if (runtime.abortController?.signal.aborted) return
      lastActivity = nowMs()
      const chunk = data.toString()

      let lines: string[]
      ;[lines, stdoutBuf] = flushLines(stdoutBuf, chunk)

      let stateChanged = false
      for (const line of lines) {
        if (!line.trim()) continue

        const { transitioned, detectedPath } = parseStateTransition(
          line,
          task,
          ffmpegState,
          progressCtx,
        )
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

    const exitCode: number = await new Promise(resolve => {
      proc.on('close', code => resolve(code ?? 1))
      proc.on('error', error => engineExecutionFailed('yt-dlp', error))
      proc.on('error', () => resolve(1))
    })

    clearInterval(watchdog)
    await killProcessTree(proc)
    runtime.abortController?.signal.removeEventListener('abort', onAbort)
    proc.stdout.removeAllListeners()
    proc.stderr.removeAllListeners()
    if (this.childProcess === proc) this.childProcess = null
    if (runtime.child === proc) runtime.child = null

    return { exitCode, detectedFinalPath, stderr: ffmpegState.stderr }
  }

  private buildAuthArgs(task: DownloadTask, _runtime: TaskRuntime): string[] {
    const args: string[] = []

    if (!isYouTubeUrl(task.url)) {
      if (task.username) args.push('--username', task.username)
      if (task.password) args.push('--password', task.password)
    }

    if (task.speedLimit && task.speedLimit !== 'auto') args.push('--limit-rate', task.speedLimit)

    return args
  }

  private parseHeightFromFormatId(formatId: string | undefined | null): number | null {
    if (!formatId) return null
    const match = /^(\d{2,5})p$/i.exec(formatId.trim())
    if (!match) return null
    const height = parseInt(match[1], 10)
    return isNaN(height) ? null : height
  }

  private buildYtdlpArgs(
    task: DownloadTask,
    profile: Profile,
    opts: { ffmpegDir: string },
    runtime: TaskRuntime,
    preferHls = false,
  ): string[] {
    const trimming = Boolean(task.startTime || task.endTime)
    const sectionBounds = trimming ? trimBounds(task) : null
    // Exact cuts re-encode at cut points via ffmpeg, so cap encoder threads and skip it on live/Kick-from-0 streams.
    const isLiveOrKickZero =
      Boolean(task.isLive) || (isKickUrl(task.url) && sectionBounds?.start === 0)
    const forceKeyframes = Boolean(sectionBounds && task.trimMode === 'exact' && !isLiveOrKickZero)
    const threadBudget = Math.max(2, Math.min(4, Math.floor(availableParallelism() / 2)))

    const ytArgs: string[] = [
      '--newline',
      '--progress',
      '--no-mtime',
      '--no-playlist',
      '--geo-bypass',

      '--ignore-config',
      '--retries',
      trimming || isKickUrl(task.url) ? '3' : '0',
      '--extractor-retries',
      trimming || isKickUrl(task.url) ? '2' : '0',
      '--fragment-retries',
      trimming || isKickUrl(task.url) ? '5' : '1',
      // Skip --continue and chunked HTTP when trimming because ffmpeg section downloads don't support byte-range resume.
      ...(trimming ? [] : ['--continue', '--throttled-rate', YOUTUBE_THROTTLED_RATE]),
      '--progress-template',
      'download:CORTEX_DL|%(info.format_id)s|%(progress.filename)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s',
      '--progress-template',
      'postprocess:CORTEX_PP:%(info.filepath)s',
      '--resize-buffer',
      '--file-access-retries',
      '5',
      '--socket-timeout',
      trimming || isKickUrl(task.url) ? '20' : '10',

      '--concurrent-fragments',
      '6',
      ...(trimming ? [] : ['--http-chunk-size', '10.0M']),
      ...this.buildAuthArgs(task, runtime),
      ...getJsRuntimeArgs(),
    ]

    if (sectionBounds) {
      const startSec = formatSectionSeconds(sectionBounds.start)
      const endSec =
        sectionBounds.end === undefined ? 'inf' : formatSectionSeconds(sectionBounds.end)
      ytArgs.push('--download-sections', `*${startSec}-${endSec}`)
      if (forceKeyframes) {
        ytArgs.push('--force-keyframes-at-cuts')
        if (!isAudioFormat(task.targetFormat)) {
          const exactCodecArgs =
            task.targetFormat === 'webm'
              ? `-threads ${threadBudget} -c:v libvpx-vp9 -deadline realtime -cpu-used 5 -c:a libopus -b:a 192k`
              : task.targetFormat === 'ogv'
                ? `-threads ${threadBudget} -c:v libtheora -c:a libvorbis`
                : task.targetFormat === 'avi'
                  ? `-threads ${threadBudget} -c:v libx264 -preset veryfast -crf 18 -c:a libmp3lame -q:a 2`
                  : `-threads ${threadBudget} -c:v libx264 -preset veryfast -crf 18 -c:a aac -b:a 192k`
          ytArgs.push('--downloader-args', `ffmpeg_o:${exactCodecArgs}`)
        }
      } else {
        const audioPrerollStart = fastCutAudioPrerollStart(task, sectionBounds)
        if (audioPrerollStart !== null) {
          // Video stream-copy snaps back to the preceding keyframe (often 2-5s earlier); pre-roll input 2 (audio)
          // and preserve original timestamps so finalization can align audio to the exact video keyframe without silence.
          const audioStartSec = formatSectionSeconds(audioPrerollStart)
          const audioDurArg =
            sectionBounds.end !== undefined
              ? ` -t ${formatSectionSeconds(Math.max(0.1, sectionBounds.end - audioPrerollStart))}`
              : ''
          ytArgs.push(
            '--downloader-args',
            `ffmpeg_i2:-ss ${audioStartSec}${audioDurArg}`,
            '--downloader-args',
            'ffmpeg_o:-copyts',
          )
        }
      }
    }

    // Stream-copy on merge for non-exact cuts to avoid re-encoding; exact cuts already encode in the downloader stage.
    if (isAudioFormat(task.targetFormat)) {
      ytArgs.push(
        '--postprocessor-args',
        'ExtractAudio+ffmpeg:-y -hide_banner -threads 2 -max_muxing_queue_size 1024',
        '--embed-thumbnail',
        '--add-metadata',
      )
    } else if (!forceKeyframes) {
      ytArgs.push(
        '--postprocessor-args',
        'Merger+ffmpeg:-y -hide_banner -threads 2 -c:v copy -c:a copy -max_muxing_queue_size 4096',
      )
    }

    const ffmpegExePath = getBinaryPath('ffmpeg')
    if (existsSync(ffmpegExePath)) ytArgs.push('--ffmpeg-location', opts.ffmpegDir)

    const heightConstraint = this.parseHeightFromFormatId(task.ytdlpFormatId)
    const protocolFilter = preferHls ? '[protocol^=m3u8]' : ''

    switch (profile) {
      case 'proAudio': {
        const audioFmt = AUDIO_SPECS[task.targetFormat as keyof typeof AUDIO_SPECS].ytDlpFormat
        ytArgs.push(
          '-x',
          '--audio-format',
          audioFmt,
          '-f',
          `bestaudio${protocolFilter}/best${protocolFilter}`,
        )
        if (task.targetFormat === 'mp3') ytArgs.push('--audio-quality', '0')
        log.info(
          `[YoutubeEngine] ProAudio profile applied: format=${audioFmt}, multi-threaded=true, metadata=embedded`,
        )
        break
      }
      case 'bestVideo': {
        const heightFilter = heightConstraint ? `[height<=${heightConstraint}]` : ''
        ytArgs.push(
          '-f',
          `bestvideo${protocolFilter}${heightFilter}+bestaudio${protocolFilter}/best${protocolFilter}${heightFilter}`,
          '-S',
          'res,fps,vcodec:h264,acodec:aac',
        )
        if (heightConstraint) {
          log.info(`[YoutubeEngine] Quality constraint applied: height<=${heightConstraint}`)
        }

        // Merge into MKV first because it accepts any codec mix (e.g., VP9/AV1 + Opus); post-processing remuxes/transcodes to the target format.
        ytArgs.push('--merge-output-format', 'mkv')
        break
      }
      default: {
        if (VIDEO_FORMATS.includes(task.targetFormat as VideoFormat)) {
          const heightFilter = heightConstraint ? `[height<=${heightConstraint}]` : ''
          const sortOrder =
            task.targetFormat === 'webm'
              ? 'res,fps,vcodec:vp9,acodec:opus'
              : task.targetFormat === 'mov' || task.targetFormat === 'm4v'
                ? 'res,fps,vcodec:h264,acodec:aac'
                : task.targetFormat === 'avi'
                  ? 'res,fps,vcodec:h264'
                  : 'res,fps'
          ytArgs.push(
            '-f',
            `bestvideo${protocolFilter}${heightFilter}+bestaudio${protocolFilter}/best${protocolFilter}${heightFilter}`,
            '-S',
            sortOrder,
          )
          if (heightConstraint) {
            log.info(
              `[YoutubeEngine] Quality constraint applied (default): height<=${heightConstraint}`,
            )
          }

          ytArgs.push('--merge-output-format', 'mkv')
        }
        break
      }
    }

    const tempDir = task.directory
    ytArgs.push('--paths', `temp:${tempDir}`)
    ytArgs.push('--paths', `home:${task.directory}`)

    ytArgs.push('-o', `${task.id}.%(ext)s`)
    ytArgs.push(task.url)

    return ytArgs
  }

  private buildErrorMessage(stderr: string): string {
    const lines = stderr
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
    const errorLine = lines.find(l => /ERROR:/.test(l)) || lines.find(l => /yt-dlp error/i.test(l))
    if (errorLine) return errorLine.replace(/^ERROR:\s*/i, '')
    return (lines.slice(-3).join(' ') || 'yt-dlp failed').trim()
  }
}
