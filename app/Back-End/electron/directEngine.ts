/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Direct Engine — HTTP direct file download with resume support.
 *
 *  Handles plain HTTP/HTTPS URLs. Supports:
 *  - Range-based resume (HTTP 206 Partial Content)
 *  - Real-time speed calculation
 *  - Automatic retry with exponential backoff (3 attempts)
 *  - Debounced state persistence
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { setTimeout as delay } from 'node:timers/promises'
import type { DownloadTask, TaskRuntime, EngineContext } from './types'
import {
  nowMs, computeSpeed, getFileSizeIfExists,
  parseTotalFromContentRange, sendNotification,
} from './utils'

function createCountingTransform(onBytes: (n: number) => void): Transform {
  return new Transform({
    transform(chunk, _encoding, callback) {
      onBytes(chunk.length)
      callback(null, chunk)
    },
  })
}

// ── Speed Limiting ───────────────────────────────────────────────────────────

/** Parse a human-readable speed limit (e.g. "1M", "500K") into bytes/sec. */
function parseSpeedLimit(limit: string | undefined): number | null {
  if (!limit || limit === 'auto') return null
  const match = limit.match(/^([\d.]+)\s*([KMGkmg])?/)
  if (!match) return null
  let value = parseFloat(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = (match[2] || '').toUpperCase()
  if (unit === 'K') value *= 1024
  else if (unit === 'M') value *= 1024 * 1024
  else if (unit === 'G') value *= 1024 * 1024 * 1024
  return Math.floor(value)
}

/**
 * Token-bucket throttle transform.  Delays chunks when the transfer
 * rate exceeds `bytesPerSec`, applying natural backpressure upstream.
 */
function createThrottleTransform(bytesPerSec: number): Transform {
  let bucket = bytesPerSec
  let lastRefillMs = Date.now()

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const now = Date.now()
      const elapsed = (now - lastRefillMs) / 1000
      bucket = Math.min(bytesPerSec, bucket + elapsed * bytesPerSec)
      lastRefillMs = now

      if (bucket >= chunk.length) {
        bucket -= chunk.length
        callback(null, chunk)
      } else {
        const deficit = chunk.length - bucket
        const waitMs = Math.ceil((deficit / bytesPerSec) * 1000)
        bucket = 0
        setTimeout(() => callback(null, chunk), waitMs)
      }
    },
  })
}

export async function runDirectDownload(
  task: DownloadTask,
  runtime: TaskRuntime,
  ctx: EngineContext,
): Promise<void> {
  runtime.abortController?.abort()
  runtime.abortController = new AbortController()
  runtime.lastSpeedSampleAtMs = null
  runtime.lastSpeedSampleBytes = null

  const existingBytes = await getFileSizeIfExists(task.filePath)
  task.downloadedBytes = existingBytes
  task.status = 'downloading'
  task.errorMessage = null
  task.updatedAtMs = nowMs()
  ctx.sendUpdate(task)

  try {
    const headers: Record<string, string> = {}
    if (existingBytes > 0) headers['Range'] = `bytes=${existingBytes}-`

    const res = await fetch(task.url, {
      signal: runtime.abortController.signal,
      headers,
      redirect: 'follow',
    })

    if (res.status !== 200 && res.status !== 206) {
      throw new Error(`Download failed (HTTP ${res.status})`)
    }

    const append = existingBytes > 0 && res.status === 206
    if (!append && existingBytes > 0) task.downloadedBytes = 0

    // Determine total file size from headers
    const totalFromRange = parseTotalFromContentRange(res.headers.get('content-range'))
    const contentLength = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(contentLength) && contentLength > 0) {
      task.totalBytes = res.status === 206
        ? (totalFromRange ?? existingBytes + contentLength)
        : contentLength
    } else {
      task.totalBytes = totalFromRange
    }
    task.updatedAtMs = nowMs()
    ctx.saveState()
    ctx.sendUpdate(task)

    if (!res.body) throw new Error('Response body is empty')

    const nodeReadable = Readable.fromWeb(res.body as unknown as NodeReadableStream)
    const fileStream = createWriteStream(task.filePath, { flags: append ? 'a' : 'w' })
    const counter = createCountingTransform((n) => {
      task.downloadedBytes += n
      computeSpeed(task, runtime)
      task.updatedAtMs = nowMs()
      // sendUpdate is throttled by the orchestrator (~5/sec)
      ctx.sendUpdate(task)
      // saveState is debounced by the orchestrator (max 1 write/sec)
      ctx.saveState()
    })

    const limitBps = parseSpeedLimit(task.speedLimit)
    const throttle = limitBps ? createThrottleTransform(limitBps) : null

    if (throttle) {
      await pipeline(nodeReadable, throttle, counter, fileStream)
    } else {
      await pipeline(nodeReadable, counter, fileStream)
    }

    task.status = 'completed'
    task.speedBytesPerSec = null
    task.updatedAtMs = nowMs()
    runtime.retries = 0
    ctx.flushSave()
    ctx.sendUpdate(task)
    sendNotification('Download Complete', `${task.title || task.filename} downloaded successfully.`)
  } catch (err) {
    if (runtime.abortController?.signal.aborted) return

    // Retry with exponential backoff
    if (runtime.retries < 3) {
      runtime.retries++
      task.status = 'queued'
      task.errorMessage = `Network error, retrying (${runtime.retries}/3)...`
      task.updatedAtMs = nowMs()
      ctx.sendUpdate(task)
      await delay(2000 * runtime.retries)
      return
    }

    task.status = 'error'
    task.speedBytesPerSec = null
    task.errorMessage = err instanceof Error ? err.message : 'Unknown error'
    task.updatedAtMs = nowMs()
    ctx.flushSave()
    ctx.sendUpdate(task)
    sendNotification('Download Failed', `Error downloading ${task.title || task.filename}`)
  }
}
