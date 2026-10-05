import { normalizeAnalysisUrl } from '../../Shared/analysisUrl'

type Job<T> = { controller: AbortController; users: number; promise: Promise<T> }

/** Reference-counted work ownership; cancelling a UI consumer never cancels batch consumers. */
export class AnalysisCoordinator<T> {
  private jobs = new Map<string, Job<T>>()
  private cache = new Map<string, { value: T; at: number }>()
  private running = 0
  private queue: (() => void)[] = []
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
    if (next) next() // transfer the occupied slot
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
