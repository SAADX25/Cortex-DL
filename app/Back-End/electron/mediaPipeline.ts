import { ensureEnginesReady, engineExecutionFailed } from './engineReadiness'
import { spawn } from 'node:child_process'
import type { DownloadTask, EngineContext } from './types'
import { getBinaryPath } from './paths'
import { killProcessTree } from './utils'
import { flushLines } from './progressParser'
import { availableParallelism } from 'node:os'

export function trimBounds(task: Pick<DownloadTask, 'startTime' | 'endTime'>): { start: number; end?: number } {
  const parse = (value: string) => {
    if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(value.trim())) throw new Error('Invalid trim time')
    const pieces = value.trim().split(':').map(Number)
    if (pieces.slice(1).some(n => n >= 60)) throw new Error('Invalid trim time')
    const seconds = pieces.reduce((sum, n) => sum * 60 + n, 0)
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid trim time')
    return seconds
  }
  const start = task.startTime ? parse(task.startTime) : 0
  const end = task.endTime ? parse(task.endTime) : undefined
  if (end !== undefined && end <= start) throw new Error('End time must be greater than start time')
  return { start, end }
}

/** Settles only after process close, including abort; listeners never outlive the attempt. */
export async function runMediaProcess(args: string[], task: DownloadTask, ctx: EngineContext, duration?: number): Promise<void> {
  await ensureEnginesReady(['ffmpeg', 'ffprobe'])
  const signal = ctx.runtime.abortController?.signal
  signal?.throwIfAborted()
  // Input options limit decoding; output options must also limit the encoder.
  const budget = Math.max(2, Math.min(4, Math.floor(availableParallelism() / 2)))
  const decoderThreads = String(Math.max(1, Math.floor(budget / 3)))
  const encoderThreads = String(Math.max(1, budget - Number(decoderThreads)))
  const proc = spawn(getBinaryPath('ffmpeg'), ['-y', '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', decoderThreads, '-filter_threads', '1', '-filter_complex_threads', '1', '-progress', 'pipe:1', ...args.slice(0, -1), '-threads', encoderThreads, args[args.length - 1]], { windowsHide: true, detached: process.platform !== 'win32' })
  proc.on('error', error => engineExecutionFailed('ffmpeg', error))
  ctx.runtime.child = proc
  let teardown: Promise<void> | undefined
  const terminate = () => { teardown ??= killProcessTree(proc) }
  let errors = ''
  let lastActivity = Date.now()
  let stalled = false
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity < 90000) return
    stalled = true
    terminate()
  }, 5000)
  watchdog.unref?.()
  let remainder = ''
  const onAbort = terminate
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  proc.stdout.on('data', (chunk: Buffer) => {
    if (signal?.aborted) return
    lastActivity = Date.now()
    const [lines, rest] = flushLines(remainder, chunk.toString())
    remainder = rest
    for (const line of lines) {
      const match = /^out_time_us=(\d+)$/.exec(line)
      if (match && duration && duration > 0) {
        task.convertingPercent = Math.min(100, Number(match[1]) / 1e6 / duration * 100)
        ctx.sendUpdate(task)
      }
    }
  })
  proc.stderr.on('data', (chunk: Buffer) => { lastActivity = Date.now(); errors = (errors + chunk.toString()).slice(-8192) })
  try {
    const code = await new Promise<number>(resolve => {
      proc.on('error', () => resolve(1))
      proc.on('close', value => resolve(value ?? 1))
    })
    signal?.throwIfAborted()
    if (stalled) throw new Error('FFmpeg stalled for 90 seconds')
    if (code !== 0) throw new Error(`FFmpeg failed: ${errors || code}`)
  } finally {
    clearInterval(watchdog)
    await teardown
    signal?.removeEventListener('abort', onAbort)
    proc.stdout.removeAllListeners()
    proc.stderr.removeAllListeners()
    if (ctx.runtime.child === proc) ctx.runtime.child = null
  }
}

/** Read every packet, then decode short boundary samples rather than every frame.
 * This detects container/read failures and sampled decode errors, not arbitrary
 * corruption in every interior frame. Keep publication gated on all checks.
 */
export async function validateMediaOutput(file: string, task: DownloadTask, ctx: EngineContext, duration?: number): Promise<void> {
  await runMediaProcess(['-xerror', '-i', file, '-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-f', 'null', '-'], task, ctx, duration)
  const offsets = [0]
  if (duration && Number.isFinite(duration) && duration > 4) offsets.push(duration - 2)
  for (const offset of offsets) {
    await runMediaProcess(['-xerror', ...(offset ? ['-ss', String(offset)] : []), '-i', file, '-t', '2', '-map', '0:v?', '-map', '0:a?', '-f', 'null', '-'], task, ctx)
  }
}
