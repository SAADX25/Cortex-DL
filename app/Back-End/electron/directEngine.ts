/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Chunked Direct Engine — Multi-Threaded HTTP Download.
 *
 *  Features:
 *  - 8x Stream Concurrency simulating IDM
 *  - Pre-flight HEAD request for 'Accept-Ranges' detection
 *  - Fallbacks to single-stream architecture if server is restrictive
 *  - Sparse file allocation avoiding 100% CPU Muxing
 *  - Granular chunk-level error retries
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createWriteStream, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { setTimeout as delay } from 'node:timers/promises'
import log from 'electron-log'

import type { DownloadTask, TaskRuntime, EngineContext } from './types'
import { nowMs, computeSpeed, parseTotalFromContentRange, sendNotification } from './utils'

// ── Globals & Constants ──────────────────────────────────────────────────────
const MAX_CHUNKS = 8
const MAX_RETRIES_PER_CHUNK = 3

// ── Stream Transform ─────────────────────────────────────────────────────────

function createCountingTransform(onBytes: (n: number) => void): Transform {
  return new Transform({
    transform(chunk, _encoding, callback) {
      onBytes(chunk.length)
      callback(null, chunk)
    },
  })
}

/** Token-bucket throttle transform. */
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

// ── Core Engine ──────────────────────────────────────────────────────────────

export async function runDirectDownload(
  task: DownloadTask,
  runtime: TaskRuntime,
  ctx: EngineContext,
): Promise<void> {
  runtime.abortController?.abort()
  runtime.abortController = new AbortController()
  runtime.lastSpeedSampleAtMs = null
  runtime.lastSpeedSampleBytes = null

  task.status = 'downloading'
  task.errorMessage = null
  task.updatedAtMs = nowMs()
  ctx.sendUpdate(task)

  log.info(`[DirectEngine] Initiating download for task: ${task.id} (${task.url.slice(0, 60)}...)`)

  try {
    // 1. Pre-flight Check (HEAD Request)
    log.info(`[DirectEngine] Sending HEAD request to detect Range capability...`)
    
    let headUrl = task.url
    let supportsRange = false
    let totalBytes: number | null = null

    try {
      const headRes = await fetch(task.url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: runtime.abortController.signal
      })
      // Usually redirects follow automatically. 
      // If we got a 200/206, grab headers.
      if (headRes.ok) {
        headUrl = headRes.url // actual URL after redirects
        const acceptRanges = headRes.headers.get('accept-ranges')
        if (acceptRanges === 'bytes') supportsRange = true
        
        const cLen = Number(headRes.headers.get('content-length'))
        if (Number.isFinite(cLen) && cLen > 0) {
          totalBytes = cLen
        }
      }
    } catch (e: any) {
      if (runtime.abortController.signal.aborted) return
      log.warn(`[DirectEngine] HEAD request failed, checking fallback GET...`, e.message)
    }

    // If we resumed and file exists but we are changing logic, 
    // handle resume safely by stripping back to single stream 
    // (A real IDM stores parts in mapping, to keep it simple here, we overwrite if no mapping, or fallback)
    let existingStats = 0
    if (existsSync(task.filePath)) {
      const st = await fs.stat(task.filePath)
      existingStats = st.size
    }

    let useChunked = false
    if (supportsRange && totalBytes && totalBytes > 1024 * 1024 && existingStats === 0) {
      // Minimum 1MB to bother chunking. ExistingStats === 0 ensures we don't corrupt a resumed single-stream file.
      useChunked = true
    }

    if (useChunked && totalBytes) {
      log.info(`[DirectEngine] Range check SUCCESS. Total: ${totalBytes} bytes. Commencing 8-stream chunked download.`)
      await executeChunkedDownload(task, runtime, ctx, headUrl, totalBytes)
    } else {
      log.info(`[DirectEngine] Range check FAILED or File Resumed. Defaulting to legacy stream...`)
      await executeSingleStream(task, runtime, ctx, headUrl, existingStats)
    }

  } catch (err: any) {
    if (runtime.abortController?.signal.aborted) return
    log.error(`[DirectEngine] Critical error:`, err)

    // Retry with exponential backoff on fatal
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

// ── Chunked Downloader ───────────────────────────────────────────────────────

async function executeChunkedDownload(
  task: DownloadTask,
  runtime: TaskRuntime,
  ctx: EngineContext,
  url: string,
  totalBytes: number
) {
  task.totalBytes = totalBytes
  task.downloadedBytes = 0
  ctx.saveState()
  ctx.sendUpdate(task)

  // Sub-allocate sparse file securely
  log.info(`[DirectEngine] Allocating sparse file: ${task.filePath}`)
  const fh = await fs.open(task.filePath, 'w')
  await fh.truncate(totalBytes)
  await fh.close()

  // Calculate Chunks
  const chunkSize = Math.ceil(totalBytes / MAX_CHUNKS)
  const chunkDefs = Array.from({ length: MAX_CHUNKS }).map((_, i) => {
    const start = i * chunkSize
    const end = Math.min((i + 1) * chunkSize - 1, totalBytes - 1)
    return { id: i + 1, start, end, downloaded: 0, total: end - start + 1 }
  }).filter(c => c.start <= c.end)

  log.info(`[DirectEngine] Spawning ${chunkDefs.length} chunks...`)

  const limitBps = parseSpeedLimit(task.speedLimit)
  const chunkLimit = limitBps ? Math.floor(limitBps / chunkDefs.length) : null

  let lastThrottleTick = 0

  await Promise.all(
    chunkDefs.map(async (chunk) => {
      let chunkRetries = 0

      while (chunkRetries <= MAX_RETRIES_PER_CHUNK) {
        if (runtime.abortController?.signal.aborted) break

        try {
          const streamStart = chunk.start + chunk.downloaded
          const streamEnd = chunk.end

          if (streamStart > streamEnd) break // Done this chunk

          const res = await fetch(url, {
            headers: { 'Range': `bytes=${streamStart}-${streamEnd}` },
            signal: runtime.abortController?.signal
          })

          if (!res.ok && res.status !== 206) {
            throw new Error(`HTTP ${res.status}`)
          }
          if (!res.body) throw new Error('Empty body')

          const nodeReadable = Readable.fromWeb(res.body as unknown as NodeReadableStream)
          
          // fs flags 'r+' is required to write to specific offsets of an existing sparse file reliably without truncating
          const fileStream = createWriteStream(task.filePath, { flags: 'r+', start: streamStart })

          const counter = createCountingTransform((n) => {
            chunk.downloaded += n
            task.downloadedBytes += n
            
            computeSpeed(task, runtime)
            task.updatedAtMs = nowMs()
            
            // Limit event spam: 10 calls per sec max dynamically
            if (nowMs() - lastThrottleTick > 100) {
              lastThrottleTick = nowMs()
              ctx.sendUpdate(task)
              ctx.saveState()
            }
          })

          const throttle = chunkLimit ? createThrottleTransform(chunkLimit) : null
          if (throttle) {
            await pipeline(nodeReadable, throttle, counter, fileStream)
          } else {
            await pipeline(nodeReadable, counter, fileStream)
          }

          log.info(`[DirectEngine] Chunk ${chunk.id} completed.`)
          break // Success, escape retry loop
          
        } catch (e: any) {
          if (runtime.abortController?.signal.aborted) return
          chunkRetries++
          log.warn(`[DirectEngine] Chunk ${chunk.id} connection dropped. Retry ${chunkRetries}/${MAX_RETRIES_PER_CHUNK}. Error: ${e.message}`)
          if (chunkRetries > MAX_RETRIES_PER_CHUNK) {
            throw new Error(`Chunk ${chunk.id} failed unconditionally.`)
          }
          await delay(1000 * chunkRetries)
        }
      }
    })
  )

  if (runtime.abortController?.signal.aborted) return

  // Validate Completion (Tolerance of 1 byte in case boundaries glitch)
  if (task.downloadedBytes >= totalBytes) {
    task.status = 'completed'
    task.speedBytesPerSec = null
    task.updatedAtMs = nowMs()
    runtime.retries = 0
    ctx.flushSave()
    ctx.sendUpdate(task)
    log.info(`[DirectEngine] Multi-part chunked download fully assembled!`)
    try {
      sendNotification('Download Complete', `${task.title || task.filename} downloaded successfully.`)
    } catch {}
  } else {
    throw new Error('Corrupt assembly - total bytes downloaded does not match headers.')
  }
}

// ── Single-Stream Downloader (Legacy Fallback) ───────────────────────────────

async function executeSingleStream(
  task: DownloadTask,
  runtime: TaskRuntime,
  ctx: EngineContext,
  url: string,
  existingBytes: number
) {
  task.downloadedBytes = existingBytes
  ctx.sendUpdate(task)

  const headers: Record<string, string> = {}
  if (existingBytes > 0) headers['Range'] = `bytes=${existingBytes}-`

  const res = await fetch(url, {
    signal: runtime.abortController!.signal,
    headers,
    redirect: 'follow',
  })

  if (res.status !== 200 && res.status !== 206) {
    throw new Error(`Download failed (HTTP ${res.status})`)
  }

  const append = existingBytes > 0 && res.status === 206
  if (!append && existingBytes > 0) task.downloadedBytes = 0

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
    ctx.sendUpdate(task)
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
  try {
    sendNotification('Download Complete', `${task.title || task.filename} downloaded successfully.`)
  } catch {}
}
