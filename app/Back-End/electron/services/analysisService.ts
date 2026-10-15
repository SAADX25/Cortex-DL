import { normalizeAnalysisUrl } from '../../../Shared/analysisUrl'
import log from 'electron-log'
import { engineExecutionFailed } from '../engines/engineManager'
import { spawn } from 'node:child_process'
import { killProcessTree } from '../utils'
import { StringDecoder } from 'node:string_decoder'

type Job<T> = { controller: AbortController; users: number; promise: Promise<T> }

export class AnalysisCoordinator<T> {
  private jobs = new Map<string, Job<T>>()
  private cache = new Map<string, { value: T; at: number }>()
  private running = 0
  private queue: (() => void)[] = []
  invalidate(input: string, scope = ''): void { this.cache.delete(`${normalizeAnalysisUrl(input)}\0${scope}`) }
  constructor(private limit = 3, private ttl = 300000, private max = 50,
    private now = Date.now, private cacheable: (value: T) => boolean = () => true, private stable: (value: T) => T = value => value) {}

  private async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    if (this.running >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const ready = () => { signal.removeEventListener('abort', abort); resolve() }
        const abort = () => {
          this.queue = this.queue.filter(item => item !== ready)
          reject(signal.reason)
        }
        this.queue.push(ready)
        signal.addEventListener('abort', abort, { once: true })
      })
    } else this.running++
    if (signal.aborted) { this.release(); signal.throwIfAborted() }
    return () => this.release()
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) next()
    else this.running--
  }

  run(input: string, work: (url: string, signal: AbortSignal) => Promise<T>, signal?: AbortSignal, scope = ''): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    const normalized = normalizeAnalysisUrl(input)
    const key = `${normalized}\0${scope}`
    const cached = this.cache.get(key)
    if (cached && this.now() - cached.at < this.ttl) {
      this.cache.delete(key); this.cache.set(key, cached)
      return Promise.resolve(structuredClone(cached.value))
    }
    this.cache.delete(key)
    let job = this.jobs.get(key)
    if (!job || job.controller.signal.aborted) {
      const controller = new AbortController()
      job = { controller, users: 0, promise: Promise.resolve(undefined as T) }
      const owned = job
      job.promise = (async () => {
        const release = await this.acquire(controller.signal)
        try {
          const value = await work(normalized, controller.signal)
          controller.signal.throwIfAborted()
          if (this.cacheable(value)) {
            this.cache.delete(key)
            this.cache.set(key, { value: this.stable(structuredClone(value)), at: this.now() })
            if (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!)
          }
          return value
        } finally { release() }
      })().finally(() => { if (this.jobs.get(key) === owned) this.jobs.delete(key) })
      this.jobs.set(key, job)
    }
    const owned = job
    owned.users++
    return new Promise<T>((resolve, reject) => {
      let done = false
      const finish = (action: () => void) => {
        if (done) return
        done = true
        signal?.removeEventListener('abort', abort)
        if (--owned.users === 0) owned.controller.abort()
        action()
      }
      const abort = () => finish(() => reject(signal?.reason))
      signal?.addEventListener('abort', abort, { once: true })
      owned.promise.then(value => finish(() => resolve(structuredClone(value))), error => finish(() => reject(error)))
      if (signal?.aborted) abort()
    })
  }
}

export async function fetchBoundedJson(url: string, signal?: AbortSignal, timeoutMs = 3000): Promise<any> {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`) }
    if (!response.body) throw new Error('Empty response')
    const reader = response.body.getReader()
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 2 * 1024 * 1024) throw new Error('JSON response exceeds size limit')
        chunks.push(value)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}

export function analysisTiming(name: string, start: number): void {
  if (process.env.CORTEX_ANALYSIS_DEBUG === '1') log.info(`[analysis timing] ${name}=${Date.now() - start}ms`)
}

export function extractAnalysis(binary: string, args: string[], signal: AbortSignal,
  maxBytes = 32 * 1024 * 1024, timeoutMs = 90000, diagnostics?: (stderr: string) => void): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const child = spawn(binary, args, { windowsHide: true, detached: process.platform !== 'win32',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    child.on('error', error => engineExecutionFailed('yt-dlp', error))
    child.once('spawn', () => analysisTiming('ytdlpStartupMs', start))
    let output = ''
    const decoder = new StringDecoder('utf8')
    let bytes = 0
    let stderr = ''
    let failure: Error | undefined
    let teardown: Promise<void> | undefined
    const stop = () => { teardown ??= killProcessTree(child) }
    const timer = setTimeout(() => { failure = new Error('Analysis timed out'); stop() }, timeoutMs)
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    child.stdout.on('data', (data: Buffer) => {
      bytes += data.length
      if (bytes > maxBytes) { failure ??= new Error('Analysis output exceeds size limit'); stop(); return }
      if (!failure && !signal.aborted) output += decoder.write(data)
    })
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-8192) })
    child.on('error', error => { failure = error })
    child.on('close', async code => {
      analysisTiming('ytdlpExtractionMs', start)
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      await teardown
      child.stdout.removeAllListeners(); child.stderr.removeAllListeners()
      if (signal.aborted) reject(signal.reason)
      else if (failure) reject(failure)
      else if (code !== 0) reject(new Error(stderr || `Analysis exited with code ${code}`))
      else { diagnostics?.(stderr); resolve(output + decoder.end()) }
    })
  })
}

export async function isDirectMedia(url: string, signal: AbortSignal): Promise<boolean> {
  if (!/\.(?:mp4|webm|mkv|mov|mp3|m4a|wav|flac|ogg|opus)(?:[?#]|$)/i.test(url)) return false
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal })
    return response.ok && /^(?:video|audio)\//i.test(response.headers.get('content-type') ?? '')
  } catch {
    signal.throwIfAborted()
    return false
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
