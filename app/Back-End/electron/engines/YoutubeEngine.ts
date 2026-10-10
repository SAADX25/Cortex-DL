import { ensureEnginesReady, engineExecutionFailed } from '../engineReadiness'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import type { DownloadTask, EngineContext, TaskRuntime, VideoFormat, EngineResult } from '../types'
import { VIDEO_FORMATS } from '../types'
import { AUDIO_SPECS, isAudioFormat } from '../audioFormats'
import { findTaskMediaFile, probeMediaFile } from '../mediaFiles'
import { getBinaryPath } from '../paths'
import { nowMs, killProcessTree } from '../utils'
import {
  parseDownloadProgress,
  parseFfmpegProgress,
  parseStateTransition,
  flushLines,
} from '../progressParser'
import type { FfmpegState } from '../progressParser'
import type { IEngine } from './IEngine'
import { checkJsRuntime, getJsRuntimeArgs, YOUTUBE_EXTRACTOR_ARGS } from '../ytdlp'
import { isYouTubeUrl, youtubeErrorCode } from '../../../Shared/youtubeErrors'
import { prepareYouTubeSubtitle, embedYouTubeSubtitle } from '../youtubeSubtitles'
import { diagnosticCategories, youtubeDiagnostic } from '../youtubeDiagnostics'
import { findCompletedYouTubeMedia, rememberCompletedYouTubeMedia } from '../youtubeMediaCache'

type Profile = 'proAudio' | 'bestVideo' | 'default'

const YOUTUBE_THROTTLED_RATE = '512K'

interface YtdlpRunResult {
  exitCode: number
  detectedFinalPath: string | null
  stderr: string
}


export class YoutubeEngine implements IEngine {
  private runtime: TaskRuntime | null = null
  private childProcess: ChildProcessWithoutNullStreams | null = null

  async download(task: DownloadTask, context?: EngineContext): Promise<EngineResult> {
    await ensureEnginesReady(['yt-dlp', 'deno', 'ffmpeg', 'ffprobe'])
    await checkJsRuntime()
    if (!context) throw new Error('[YoutubeEngine] Missing EngineContext')
    const runtime = context.runtime
    this.runtime = runtime
    runtime.abortController ??= new AbortController()
    runtime.abortController.signal.throwIfAborted()
    if (!existsSync(getBinaryPath('yt-dlp'))) return { kind: 'fatal-error', message: 'yt-dlp binary is missing' }
    task.ytdlpExpectedBytes = undefined
    task.ytdlpExpectedStreamCount = undefined
    task.ytdlpStreams = undefined
    task.totalBytes = null
    task.downloadedBytes = 0
    const profile = this.selectProfile(task)
    const publicFirst = isYouTubeUrl(task.url)
    let subtitle: string | undefined
    const prepareSubtitle = async () => {
      if (publicFirst && task.subtitleLanguage && VIDEO_FORMATS.includes(task.targetFormat as VideoFormat)) {
        subtitle = await prepareYouTubeSubtitle(task, runtime.abortController!.signal, () => {
          const subtitleArgs = this.buildYtdlpArgs(task, profile, { ffmpegDir: path.dirname(getBinaryPath('ffmpeg')) }, runtime)
          subtitleArgs.splice(subtitleArgs.indexOf('--embed-subs'), 1)
          // Caption discovery must not depend on the selected video format existing.
          const selector = subtitleArgs.indexOf('-f')
          if (selector >= 0) subtitleArgs.splice(selector, 2)
          subtitleArgs.splice(subtitleArgs.length - 1, 0, '--skip-download', '--no-progress', '--ignore-no-formats-error', '--sub-format', 'vtt')
          return this.runYtdlpAttempt(task, context, runtime, subtitleArgs, profile)
        })
      }
    }
    const finishWithSubtitles = async (candidate: string): Promise<EngineResult> => {
      try {
        await prepareSubtitle()
        return { kind: 'success', candidate: subtitle ? await embedYouTubeSubtitle(task, context, candidate, subtitle) : candidate }
      } catch (error) {
        runtime.abortController!.signal.throwIfAborted()
        return { kind: 'fatal-error', message: error instanceof Error ? error.message : 'Subtitle download failed' }
      }
    }
    // Resume a subtitle-only failure from a fully downloaded, attempt-owned file.
    if (publicFirst && task.subtitleLanguage) {
      const cached = await findCompletedYouTubeMedia(task)
      if (cached) {
        try {
          const probe = await probeMediaFile(cached, child => { runtime.child = child }, runtime.abortController.signal)
          if (probe.streams?.some(stream => stream.codec_type === 'video')) return finishWithSubtitles(cached)
        } catch { runtime.abortController.signal.throwIfAborted() }
      }
    }
    const mediaTask = publicFirst && task.subtitleLanguage ? { ...task, subtitleLanguage: undefined } : task
    if (!task.title || !task.thumbnail) await this.prefetchMetadata(task, context, runtime).catch(e => log.warn('[YoutubeEngine] Metadata:', e))
    runtime.abortController.signal.throwIfAborted()
    const args = this.buildYtdlpArgs(mediaTask, profile, { ffmpegDir: path.dirname(getBinaryPath('ffmpeg')) }, runtime)
    let result = await this.runYtdlpAttempt(task, context, runtime, args, profile)
    runtime.abortController.signal.throwIfAborted()
    // Some public HTTPS formats are listed but denied by YouTube. Try its HLS
    // formats once, preserving the quality cap and requested subtitles.
    if (publicFirst && result.exitCode !== 0 && /HTTP Error 403/i.test(result.stderr)
      && !youtubeErrorCode(result.stderr) && !/Unable to download (?:video )?subtitles?/i.test(result.stderr)) {
      const hlsArgs = this.buildYtdlpArgs(mediaTask, profile, { ffmpegDir: path.dirname(getBinaryPath('ffmpeg')) }, runtime, true)
      result = await this.runYtdlpAttempt(task, context, runtime, hlsArgs, profile)
    }
    runtime.abortController.signal.throwIfAborted()
    if (result.exitCode === 0) {
      const candidate = await findTaskMediaFile(task, result.detectedFinalPath)
      runtime.abortController.signal.throwIfAborted()
      if (candidate) {
        if (publicFirst && task.subtitleLanguage) await rememberCompletedYouTubeMedia(task, candidate)
        return finishWithSubtitles(candidate)
      }
      return { kind: 'fatal-error', message: 'yt-dlp produced no final media file' }
    }
    const youtubeFailure = publicFirst ? youtubeErrorCode(result.stderr) : null
    if (youtubeFailure) return { kind: 'fatal-error', message: youtubeFailure }
    if (publicFirst && /HTTP (?:Error )?403/i.test(result.stderr)) return { kind: 'fatal-error', message: 'YOUTUBE_FORMATS_RESTRICTED' }
    return { kind: 'retryable-error', message: this.buildErrorMessage(result.stderr), delayMs: Math.min(3000 * 2 ** runtime.retries, 60000) }
  }

  pause(): void {
    // Signal abort — actual process tree kill is handled by DownloadManager.
    log.info(`[YoutubeEngine] Pausing — aborting child process...`)
    this.runtime?.abortController?.abort()
  }

  stop(): void {
    // Signal abort — actual process tree kill is handled by DownloadManager.
    log.info(`[YoutubeEngine] Stopping — aborting child process...`)
    this.runtime?.abortController?.abort()
  }

  private selectProfile(task: DownloadTask): Profile {
    if (isAudioFormat(task.targetFormat)) return 'proAudio'
    if (task.targetFormat === 'mp4') return 'bestVideo'
    return 'default'
  }

  private async prefetchMetadata(task: DownloadTask, context: EngineContext, runtime: TaskRuntime): Promise<void> {
    const ytDlpPath = getBinaryPath('yt-dlp')

    const selection = this.buildYtdlpArgs(task, this.selectProfile(task), { ffmpegDir: path.dirname(getBinaryPath('ffmpeg')) }, runtime)
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
      ...(YOUTUBE_EXTRACTOR_ARGS ? ['--extractor-args', YOUTUBE_EXTRACTOR_ARGS] : []),
      ...this.buildAuthArgs(task, runtime),
      ...getJsRuntimeArgs(),
      task.url,
    ]

    const proc = spawn(ytDlpPath, metaArgs, { windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, PYTHONUNBUFFERED: '1', ELECTRON_RUN_AS_NODE: '1' } })


    // Track metadata prefetch in the same attempt as the download.
    this.childProcess = proc
    runtime.child = proc
    const onAbort = () => { void killProcessTree(proc) }
    runtime.abortController?.signal.addEventListener('abort', onAbort, { once: true })
    proc.stderr.resume()
    const closed = new Promise<void>(resolve => { proc.on('close', () => resolve()); proc.on('error', () => resolve()) })
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
      task.ytdlpExpectedStreamCount = selected.length
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
  ): Promise<YtdlpRunResult> {
    const proc = spawn(getBinaryPath('yt-dlp'), args, {
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, PYTHONUNBUFFERED: '1', ELECTRON_RUN_AS_NODE: '1' },
    })

    this.childProcess = proc
    runtime.child = proc

    const onAbort = () => { void killProcessTree(proc) }
    runtime.abortController?.signal.addEventListener('abort', onAbort, { once: true })
    if (runtime.abortController?.signal.aborted) onAbort()

    log.info(`[YoutubeEngine] Spawned yt-dlp for task ${task.id} (profile=${profile})`)

    const ffmpegState: FfmpegState = { totalDuration: null, stderr: '' }
    let stdoutBuf = ''
    let stderrBuf = ''
    let lastUpdateAtMs = 0
    let detectedFinalPath: string | null = null

    const progressCtx = {
      sendUpdate: (t: DownloadTask) => context.sendUpdate(t),
      saveState: () => context.saveState(),
    }

    let lastActivity = nowMs()
    const watchdog = setInterval(() => {
      if (nowMs() - lastActivity >= 90000) void killProcessTree(proc)
    }, 5000)
    watchdog.unref?.()
    const MAX_STDERR_BYTES = 64 * 1024

    proc.stderr.on('data', (data: Buffer) => {
      if (runtime.abortController?.signal.aborted) return
      lastActivity = nowMs()
      const chunk = data.toString()
      // Extractor output can contain signed URLs; retain categories only.

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
      // Parse progress without logging signed extractor URLs.

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
      proc.on('error', error => engineExecutionFailed('yt-dlp', error))
    proc.on('error', () => resolve(1))
    })

    // Retire handles and callbacks only after process settlement.
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

    // Generic provider credentials never apply to public YouTube requests.
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
    const hasSubtitles = task.subtitleLanguage && VIDEO_FORMATS.includes(task.targetFormat as VideoFormat)

    const ytArgs: string[] = [
      '--newline',
      '--progress',
      '--no-mtime',
      '--no-playlist',
      '--geo-bypass',

      '--ignore-config',
      '--retries', '0', '--extractor-retries', '0', '--fragment-retries', '1',
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

    if (isAudioFormat(task.targetFormat)) {
      ytArgs.push('--postprocessor-args', 'ExtractAudio+ffmpeg:-y -hide_banner -threads 2 -max_muxing_queue_size 1024', '--embed-thumbnail', '--add-metadata')
    } else {
      ytArgs.push('--postprocessor-args', hasSubtitles && task.targetFormat === 'mp4'
        ? 'Merger+ffmpeg:-y -hide_banner -threads 2 -c:v copy -c:a copy -c:s mov_text -movflags +faststart'
        : 'Merger+ffmpeg:-y -hide_banner -threads 2 -c:v copy -c:a copy -max_muxing_queue_size 4096')
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
    const protocolFilter = preferHls ? '[protocol^=m3u8]' : ''

    switch (profile) {
      case 'proAudio': {
        const audioFmt = AUDIO_SPECS[task.targetFormat as keyof typeof AUDIO_SPECS].ytDlpFormat
        ytArgs.push('-x', '--audio-format', audioFmt, '-f', `bestaudio${protocolFilter}/best${protocolFilter}`)
        if (task.targetFormat === 'mp3') ytArgs.push('--audio-quality', '0')
        log.info(`[YoutubeEngine] ProAudio profile applied: format=${audioFmt}, multi-threaded=true, metadata=embedded`)
        break
      }
      case 'bestVideo': {
        const heightFilter = heightConstraint ? `[height<=${heightConstraint}]` : ''
        ytArgs.push(
          '-f',
          `bestvideo${protocolFilter}${heightFilter}+bestaudio${protocolFilter}/best${protocolFilter}${heightFilter}`,
          '-S', 'res,fps,vcodec:h264,acodec:aac'
        )
        if (heightConstraint) {
          log.info(`[YoutubeEngine] Quality constraint applied: height<=${heightConstraint}`)
        }
        // Preserve the best source codecs; the registry handles final MP4 conversion.
        ytArgs.push('--merge-output-format', 'mkv')
        break
      }
      default: {
        if (VIDEO_FORMATS.includes(task.targetFormat as VideoFormat)) {
          const heightFilter = heightConstraint ? `[height<=${heightConstraint}]` : ''
          ytArgs.push('-f', `bestvideo${protocolFilter}${heightFilter}+bestaudio${protocolFilter}/best${protocolFilter}${heightFilter}`, '-S', 'res,fps')
          if (heightConstraint) {
            log.info(`[YoutubeEngine] Quality constraint applied (default): height<=${heightConstraint}`)
          }

          // MKV accepts downloaded codecs; the registry decides the final conversion.
          ytArgs.push('--merge-output-format', task.targetFormat === 'm4v' ? 'mp4' : 'mkv')
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
    const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const errorLine = lines.find(l => /ERROR:/.test(l)) || lines.find(l => /yt-dlp error/i.test(l))
    if (errorLine) return errorLine.replace(/^ERROR:\s*/i, '')
    return (lines.slice(-3).join(' ') || 'yt-dlp failed').trim()
  }
}
