// Download engine for Meta Threads posts, supporting progressive streams and DASH video+audio muxing.
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import log from 'electron-log'
import {
  type DownloadTask,
  type EngineContext,
  type EngineResult,
  type TaskRuntime,
} from '../types'
import { type IEngine } from './IEngine'
import { ensureEnginesReady } from './engineManager'
import { runMediaProcess } from '../services/mediaService'
import {
  resolveThreadsMedia,
  selectThreadsDownloadPlan,
  THREADS_REQUEST_HEADERS,
  type ThreadsStreamFormat,
} from '../services/threadsService'
import { threadsErrorCode } from '../../../Shared/threadsErrors'
import { computeSpeed, nowMs } from '../utils'

const STREAM_TIMEOUT_MS = 30_000
const STALL_TIMEOUT_MS = 60_000
const PROGRESS_INTERVAL_MS = 150

function parseSpeedLimitBytesPerSec(value?: string): number | null {
  if (!value || value === 'auto') return null
  const match = /^(\d+(?:\.\d+)?)\s*([KMG])?$/i.exec(value.trim())
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = (match[2] ?? '').toUpperCase()
  const multiplier = unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : unit === 'K' ? 1024 : 1
  return Math.round(amount * multiplier)
}

export class ThreadsEngine implements IEngine {
  private runtime: TaskRuntime | null = null
  private stopRequested = false

  async download(task: DownloadTask, context?: EngineContext): Promise<EngineResult> {
    if (!context) throw new Error('[ThreadsEngine] Missing EngineContext')
    const runtime = context.runtime
    this.runtime = runtime
    this.stopRequested = false
    runtime.abortController ??= new AbortController()
    const signal = runtime.abortController.signal
    signal.throwIfAborted()

    await ensureEnginesReady(['ffmpeg', 'ffprobe'])
    signal.throwIfAborted()

    task.totalBytes = null
    task.downloadedBytes = 0
    task.downloadPercent = undefined
    task.convertingPercent = undefined
    task.speedBytesPerSec = null
    runtime.lastSpeedSampleAtMs = null
    runtime.lastSpeedSampleBytes = null

    try {
      let extracted = await resolveThreadsMedia(task.url, signal)
      signal.throwIfAborted()

      // A carousel URL without ?carousel=N resolves as a playlist; default to the first playable item.
      if (extracted.kind === 'playlist') {
        const first = extracted.items[0]
        if (!first) return { kind: 'fatal-error', message: 'THREADS_NO_MEDIA' }
        extracted = await resolveThreadsMedia(first.url, signal)
        signal.throwIfAborted()
        if (extracted.kind !== 'media') return { kind: 'fatal-error', message: 'THREADS_NO_MEDIA' }
      }

      const { media } = extracted
      if (!task.title && media.title) task.title = media.title
      if (!task.thumbnail && media.thumbnail) task.thumbnail = media.thumbnail
      task.phase = 'downloading'
      task.updatedAtMs = nowMs()
      context.sendUpdate(task)

      const plan = selectThreadsDownloadPlan(media, task.targetFormat, task.ytdlpFormatId)
      const speedLimitBps = parseSpeedLimitBytesPerSec(task.speedLimit)

      if (plan.mode === 'single') {
        const dest = path.join(task.directory, `${task.id}.${plan.stream.ext}`)
        task.totalBytes = plan.stream.filesize ?? null
        await this.downloadStreamToFile(plan.stream, dest, task, context, signal, 0, speedLimitBps)
        signal.throwIfAborted()
        return { kind: 'success', candidate: dest }
      }

      const videoDest = path.join(task.directory, `${task.id}.video.${plan.video.ext}`)
      const audioDest = path.join(task.directory, `${task.id}.audio.${plan.audio.ext}`)
      const knownTotal =
        plan.video.filesize && plan.audio.filesize
          ? plan.video.filesize + plan.audio.filesize
          : null
      task.totalBytes = knownTotal

      // Download video then audio sequentially so progress advances smoothly across the combined byte total.
      const videoBytes = await this.downloadStreamToFile(
        plan.video,
        videoDest,
        task,
        context,
        signal,
        0,
        speedLimitBps,
        knownTotal !== null,
      )
      signal.throwIfAborted()
      await this.downloadStreamToFile(
        plan.audio,
        audioDest,
        task,
        context,
        signal,
        videoBytes,
        speedLimitBps,
        knownTotal !== null,
      )
      signal.throwIfAborted()

      task.status = 'merging'
      task.phase = 'merging'
      task.convertingPercent = undefined
      task.speedBytesPerSec = null
      task.updatedAtMs = nowMs()
      context.sendUpdate(task)

      // Remux DASH tracks into MP4 without re-encoding, moving the moov atom upfront for instant playback.
      const muxedDest = path.join(task.directory, `${task.id}.mp4`)
      await runMediaProcess(
        [
          '-i',
          videoDest,
          '-i',
          audioDest,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          '-f',
          'mp4',
          muxedDest,
        ],
        task,
        context,
        media.duration,
      )
      signal.throwIfAborted()

      await Promise.all([
        fs.unlink(videoDest).catch(() => {}),
        fs.unlink(audioDest).catch(() => {}),
      ])

      return { kind: 'success', candidate: muxedDest }
    } catch (error) {
      if (this.stopRequested || signal.aborted) {
        return { kind: 'paused' }
      }
      const code = threadsErrorCode(error)
      if (code) {
        return { kind: 'fatal-error', message: code }
      }
      log.error(`[ThreadsEngine] Task ${task.id} failed:`, error)
      return {
        kind: 'retryable-error',
        message: error instanceof Error ? error.message : String(error),
        delayMs: Math.min(3000 * 2 ** runtime.retries, 60000),
      }
    }
  }

  private async downloadStreamToFile(
    stream: ThreadsStreamFormat,
    destination: string,
    task: DownloadTask,
    context: EngineContext,
    signal: AbortSignal,
    baseBytes: number,
    speedLimitBps: number | null,
    preserveCombinedTotal = false,
  ): Promise<number> {
    const controller = new AbortController()
    const onAbort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()

    let lastActivityAt = nowMs()
    const responseTimer = setTimeout(
      () => controller.abort(new Error('Threads media request timed out')),
      STREAM_TIMEOUT_MS,
    )
    const stallWatchdog = setInterval(() => {
      if (nowMs() - lastActivityAt >= STALL_TIMEOUT_MS) {
        controller.abort(new Error('Threads media download stalled'))
      }
    }, 5_000)
    stallWatchdog.unref?.()

    let received = 0
    try {
      // Meta CDN endpoints reject bare requests without a browser User-Agent and Threads Referer.
      const response = await fetch(stream.url, {
        headers: {
          'User-Agent': THREADS_REQUEST_HEADERS['User-Agent'],
          Referer: 'https://www.threads.com/',
        },
        redirect: 'follow',
        signal: controller.signal,
      })
      clearTimeout(responseTimer)

      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {})
        throw new Error(`Threads CDN returned HTTP ${response.status}`)
      }

      const contentLength = Number(response.headers.get('content-length') ?? '0')
      if (!preserveCombinedTotal && Number.isFinite(contentLength) && contentLength > 0) {
        task.totalBytes = baseBytes + contentLength
      }

      let lastUpdate = nowMs()
      let throttleWindowStart = nowMs()
      let throttleWindowBytes = 0
      let throttleTimer: ReturnType<typeof setTimeout> | null = null

      const progressTransform = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          lastActivityAt = nowMs()
          task.downloadedBytes = baseBytes + received

          const now = nowMs()
          if (now - lastUpdate >= PROGRESS_INTERVAL_MS) {
            lastUpdate = now
            computeSpeed(task, context.runtime)
            task.updatedAtMs = now
            context.sendUpdate(task)
          }

          // Pace chunks with a sliding 1s window when a per-task speed limit is configured.
          if (speedLimitBps && speedLimitBps > 0) {
            throttleWindowBytes += chunk.length
            const elapsedMs = Math.max(1, now - throttleWindowStart)
            const expectedMs = (throttleWindowBytes / speedLimitBps) * 1000
            if (expectedMs > elapsedMs + 20) {
              const waitMs = Math.min(1000, Math.round(expectedMs - elapsedMs))
              throttleTimer = setTimeout(() => {
                throttleTimer = null
                if (nowMs() - throttleWindowStart >= 1000) {
                  throttleWindowStart = nowMs()
                  throttleWindowBytes = 0
                }
                callback(null, chunk)
              }, waitMs)
              return
            }
            if (elapsedMs >= 1000) {
              throttleWindowStart = now
              throttleWindowBytes = 0
            }
          }

          callback(null, chunk)
        },
        destroy(err, callback) {
          if (throttleTimer) {
            clearTimeout(throttleTimer)
            throttleTimer = null
          }
          callback(err)
        },
      })

      await pipeline(
        Readable.fromWeb(response.body as any),
        progressTransform,
        createWriteStream(destination),
        { signal: controller.signal },
      )

      if (received <= 0) throw new Error('Threads media stream was empty')
      if (Number.isFinite(contentLength) && contentLength > 0 && received !== contentLength) {
        throw new Error(
          `Threads download size mismatch: expected ${contentLength}, got ${received}`,
        )
      }

      task.downloadedBytes = baseBytes + received
      computeSpeed(task, context.runtime)
      task.updatedAtMs = nowMs()
      context.sendUpdate(task)
      return received
    } finally {
      clearTimeout(responseTimer)
      clearInterval(stallWatchdog)
      signal.removeEventListener('abort', onAbort)
    }
  }

  pause(): void {
    log.info('[ThreadsEngine] Pausing download...')
    this.stopRequested = true
    this.runtime?.abortController?.abort()
  }

  stop(): void {
    log.info('[ThreadsEngine] Stopping download...')
    this.stopRequested = true
    this.runtime?.abortController?.abort()
  }
}
