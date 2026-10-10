import { BrowserWindow } from 'electron'
import log from 'electron-log'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { db, taskDb } from './db'
import type {
  DownloadTask, TaskRuntime, AttemptRuntime, EngineResult, StartInput, EngineContext,
  DownloadEngine, AudioFormat, TargetFormat,
} from './types'
import { STATS_CHANNEL, AUDIO_FORMATS } from './types'
import { updateTaskProgress } from '../../Shared/progressModel'
import { mediaOutputArgs, matchesMediaFormat, decideMediaConversion, validateSubtitleMedia } from './mediaFormatRegistry'
import { runMediaProcess, trimBounds, validateMediaOutput } from './mediaPipeline'
import { probeMediaFile } from './mediaFiles'
import { youtubeDiagnostic } from './youtubeDiagnostics'
import {
  sanitizeFilename, ensureDirectoryExists, nowMs, isHttpUrl,
  withExtension, getDefaultFilename, sendUpdate, throttledSendUpdate,
  killProcessTree, clearPendingTrailing, sendNotification,
} from './utils'

import type { IEngine } from './engines/IEngine'
import { DirectEngine } from './engines/DirectEngine'
import { YoutubeEngine } from './engines/YoutubeEngine'
import { FfmpegEngine } from './engines/FfmpegEngine'

type EngineEntry = {
  create: () => IEngine
  start: (engine: IEngine, task: DownloadTask, context: EngineContext) => Promise<EngineResult>
}

const engines = new Map<DownloadEngine, EngineEntry>([
  ['direct', { create: () => new DirectEngine(), start: (e, t, c) => e.download(t, c) }],
  ['ytdlp', { create: () => new YoutubeEngine(), start: (e, t, c) => e.download(t, c) }],
  ['ffmpeg', { create: () => new FfmpegEngine(), start: (e, t, c) => e.download(t, c) }],
])

const filenameTransforms: Partial<Record<DownloadEngine, (filename: string) => string>> = {
  ytdlp: (name) => name.replace(/\s+/g, '_'),
}

export class DownloadManager {
  private tasks = new Map<string, DownloadTask>()
  private runtime = new Map<string, TaskRuntime>()
  private attempts = new Map<string, AttemptRuntime>()
  private engines = new Map<string, IEngine>() 
  private win: BrowserWindow | null = null
  private maxConcurrent = 3
  private active = new Set<string>()
  private pausingAll = false
  /** Pending retry-backoff timers, keyed by task id. */
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private countedStats = new Set<string>()

  constructor() {
    this.loadState()
    this.hydrateConcurrency()
  }

  private hydrateConcurrency(): void {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('maxConcurrent') as { value: string } | undefined
      if (row) {
        const parsed = parseInt(row.value, 10)
        if ([3, 5, 10].includes(parsed)) this.maxConcurrent = parsed
      }
    } catch {
      // Keep the default concurrency when settings are unavailable.
    }
  }

  setMaxConcurrent(value: number): void {
    if (![3, 5, 10].includes(value)) return
    this.maxConcurrent = value
    try {
      db.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)').run()
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('maxConcurrent', String(value))
    } catch (err) {
      log.error('[DM] Failed to persist maxConcurrent:', err)
    }
    this.schedule()
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent
  }

  
  private loadState(): void {
    try {
      
      const rows = taskDb.getAllTasks.all() as { full_payload: string }[]
      for (const row of rows) {
        try {
          const task: DownloadTask = JSON.parse(row.full_payload)
          if (!task.id || !task.url) continue
          
          if (task.status === 'downloading' || task.status === 'merging' || task.status === 'converting' || task.status === 'pausing' || task.status === 'queued') {
            task.status = 'paused'
            task.speedBytesPerSec = null
          }
          if (task.status === 'completed' && (!task.validatedAttemptId || !existsSync(task.filePath))) {
            task.status = 'paused'
            task.speedBytesPerSec = null
          }
          if (task.status === 'completed') this.countedStats.add(task.id)
          updateTaskProgress(task)
          this.tasks.set(task.id, task)
          this.runtime.set(task.id, this.freshRuntime())
          this.upsertTaskToDb(task)
        } catch (e) {
          log.error('Failed to parse task from DB row:', e)
        }
      }
    } catch (err) {
      log.error('Error loading tasks from DB:', err)
    }
  }

  

  private saveStateImmediate(taskId?: string): void {
    try {
      if (taskId) {
        const task = this.tasks.get(taskId)
        if (task) this.upsertTaskToDb(task)
      } else {
        const trans = db.transaction((tasks: DownloadTask[]) => {
          for (const t of tasks) this.upsertTaskToDb(t)
        })
        trans(Array.from(this.tasks.values()))
      }
    } catch (err) {
      log.error('Failed to save tasks to SQLite:', err)
    }
  }

  private upsertTaskToDb(t: DownloadTask) {
    updateTaskProgress(t)
    taskDb.upsertTask.run({
      id: t.id,
      title: t.title || t.filename,
      url: t.url,
      status: t.status,
      progress: t.overallProgress ?? null,
      size: t.totalBytes || 0,
      thumbnail: t.thumbnail || '',
      engine: t.engine,
      full_payload: JSON.stringify(t)
    })
  }

  

  /** Progress writes are batched; lifecycle transitions are persisted immediately. */
  private static readonly WRITE_BEHIND_INTERVAL_MS = 1000
  private dirtyIds = new Set<string>()
  private writeBehindTimer: ReturnType<typeof setInterval> | null = null

  private markDirty(id: string): void {
    this.dirtyIds.add(id)
    if (!this.writeBehindTimer) {
      this.writeBehindTimer = setInterval(
        () => this.flushDirty(),
        DownloadManager.WRITE_BEHIND_INTERVAL_MS,
      )
      // Never keep the process alive just for this housekeeping timer.
      this.writeBehindTimer.unref?.()
    }
  }

  private flushDirty(): void {
    if (this.dirtyIds.size === 0) {
      if (this.writeBehindTimer) {
        clearInterval(this.writeBehindTimer)
        this.writeBehindTimer = null
      }
      return
    }

    const ids = Array.from(this.dirtyIds)
    this.dirtyIds.clear()

    try {
      const trans = db.transaction((idsToFlush: string[]) => {
        for (const id of idsToFlush) {
          const t = this.tasks.get(id)
          if (t) this.upsertTaskToDb(t)
        }
      })
      trans(ids)
    } catch (err) {
      log.error('[DM] Write-behind flush failed, re-queuing dirty ids:', err)
      // Don't drop the update on a transient failure — retry on the next tick.
      for (const id of ids) this.dirtyIds.add(id)
    }
  }

  flushPendingSave(): void {
    // saveStateImmediate() below persists the full in-memory state of every
    // task unconditionally, which is a superset of anything still pending
    // in the write-behind queue, so the queue can simply be dropped.
    if (this.writeBehindTimer) {
      clearInterval(this.writeBehindTimer)
      this.writeBehindTimer = null
    }
    this.dirtyIds.clear()
    for (const timer of this.retryTimers.values()) clearTimeout(timer)
    this.retryTimers.clear()
    this.saveStateImmediate()
  }

  private freshRuntime(): TaskRuntime {
    return {
      abortController: null,
      child: null,
      lastSpeedSampleAtMs: null,
      lastSpeedSampleBytes: null,
      lastIpcAtMs: 0,
      retries: 0,
    }
  }

  
  getActiveCount(): number {
    return this.active.size
  }
  attachWindow(win: BrowserWindow): void {
    this.win = win
  }

  list(): DownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAtMs - a.createdAtMs)
  }

  get(id: string): DownloadTask | null {
    return this.tasks.get(id) ?? null
  }

  async add(input: StartInput): Promise<DownloadTask> {
    trimBounds(input)
    if (!isHttpUrl(input.url)) {
      throw new Error('URL must be http or https')
    }
    
    const rawSubfolder = (input.subfolderName ?? '').trim()
    
    const safeSubfolder = rawSubfolder.replace(/[/\\:*?"<>|]/g, '').trim()
    const finalDirectory = safeSubfolder
      ? path.join(input.directory, safeSubfolder)
      : input.directory
    await ensureDirectoryExists(finalDirectory)

    const id = randomUUID()
    const targetFormat = input.targetFormat ?? 'mp4'
    const requestedEngine = input.engine ?? 'auto'
    const engine: DownloadEngine =
      requestedEngine === 'auto'
        ? this.detectEngine(input.url, targetFormat)
        : requestedEngine

    
    let filename = sanitizeFilename(input.filename || input.title || getDefaultFilename(input.url))
    filename = filenameTransforms[engine]?.(filename) ?? filename
    filename = withExtension(filename, targetFormat)

    const filePath = this.reserveOutputPath(finalDirectory, filename)
    filename = path.basename(filePath)
    const now = nowMs()

    const task: DownloadTask = {
      id,
      url: input.url,
      directory: finalDirectory,
      filename,
      filePath,
      engine,
      targetFormat,
      status: 'queued',
      totalBytes: null,
      downloadedBytes: 0,
      speedBytesPerSec: null,
      errorMessage: null,
      createdAtMs: now,
      updatedAtMs: now,
      title: input.title,
      thumbnail: input.thumbnail,
      username: input.username,
      password: input.password,
      speedLimit: input.speedLimit,
      startTime: input.startTime,
      endTime: input.endTime,
      ytdlpFormatId: input.ytdlpFormatId,
      subtitleLanguage: input.subtitleLanguage,
      subtitleIsAutomatic: input.subtitleIsAutomatic,
      fps: input.fps,
    }

    this.tasks.set(id, task)
    this.runtime.set(id, this.freshRuntime())
    this.saveStateImmediate()
    log.info(`[DM] Task added: ${id} engine=${engine} format=${targetFormat} url=${input.url.slice(0, 60)}`)
    sendUpdate(this.win, task)
    this.schedule()
    return task
  }

  async addBatch(inputs: StartInput[]): Promise<DownloadTask[]> {
    for (const input of inputs) trimBounds(input)
    const created: DownloadTask[] = []
    for (const input of inputs) {
      trimBounds(input)
      if (!isHttpUrl(input.url)) continue

      const rawSubfolder = (input.subfolderName ?? '').trim()
      
      const safeSubfolder = rawSubfolder.replace(/[/\\:*?"<>|]/g, '').trim()
      const finalDirectory = safeSubfolder
        ? path.join(input.directory, safeSubfolder)
        : input.directory
      await ensureDirectoryExists(finalDirectory)

      const id = randomUUID()
      const targetFormat = input.targetFormat ?? 'mp4'
      const requestedEngine = input.engine ?? 'auto'
      const engine: DownloadEngine =
        requestedEngine === 'auto'
          ? this.detectEngine(input.url, targetFormat)
          : requestedEngine

      let filename = sanitizeFilename(input.filename || input.title || getDefaultFilename(input.url))
      filename = filenameTransforms[engine]?.(filename) ?? filename
      filename = withExtension(filename, targetFormat)

      const filePath = this.reserveOutputPath(finalDirectory, filename)
      filename = path.basename(filePath)
      const now = nowMs()

      const task: DownloadTask = {
        id,
        url: input.url,
        directory: finalDirectory,
        filename,
        filePath,
        engine,
        targetFormat,
        status: 'queued',
        totalBytes: null,
        downloadedBytes: 0,
        speedBytesPerSec: null,
        errorMessage: null,
        createdAtMs: now,
        updatedAtMs: now,
        title: input.title,
        thumbnail: input.thumbnail,
        username: input.username,
        password: input.password,
        speedLimit: input.speedLimit,
        startTime: input.startTime,
        endTime: input.endTime,
        ytdlpFormatId: input.ytdlpFormatId,
        subtitleLanguage: input.subtitleLanguage,
        subtitleIsAutomatic: input.subtitleIsAutomatic,
        fps: input.fps,
      }

      this.tasks.set(id, task)
      this.runtime.set(id, this.freshRuntime())
      created.push(task)
      log.info(`[DM] Batch task added: ${id} engine=${engine} url=${input.url.slice(0, 60)}`)
    }

    if (created.length > 0) {
      this.saveStateImmediate()
      for (const task of created) sendUpdate(this.win, task)
      
      
      this.schedule()
    }
    return created
  }

  async pause(id: string): Promise<DownloadTask> {
    const task = this.mustGet(id)
    this.clearRetryTimer(id)
    if (task.status === 'completed' || task.status === 'canceled' || task.status === 'error' || task.status === 'paused') return task
    const attempt = this.attempts.get(id)
    task.status = attempt ? 'pausing' : 'paused'
    task.speedBytesPerSec = null
    task.updatedAtMs = nowMs()
    clearPendingTrailing(id)
    if (attempt) {
      attempt.stopReason ??= 'paused'
      attempt.abortController?.abort()
      this.engines.get(id)?.pause()
      this.saveStateImmediate(id)
      sendUpdate(this.win, task)
      await killProcessTree(attempt.child)
      await attempt.done
    }
    if (task.status === 'pausing') task.status = 'paused'
    this.saveStateImmediate(id)
    sendUpdate(this.win, task)
    this.schedule()
    return task
  }

  async resume(id: string): Promise<DownloadTask> {
    const task = this.mustGet(id)
    const attempt = this.attempts.get(id)
    if (['pausing', 'paused', 'error'].includes(task.status)) await attempt?.done
    if (this.tasks.get(id) !== task || !['paused', 'error'].includes(task.status)) return task
    this.clearRetryTimer(id)
    const runtime = this.runtime.get(id)
    if (runtime) runtime.retries = 0
    task.errorMessage = null
    task.status = 'queued'
    task.phase = 'queued'
    task.updatedAtMs = nowMs()
    this.saveStateImmediate(id)
    sendUpdate(this.win, task)
    this.schedule()
    return task
  }

  async cancel(id: string): Promise<DownloadTask> {
    const task = this.mustGet(id)
    this.clearRetryTimer(id)
    task.status = 'canceled'
    task.speedBytesPerSec = null
    task.updatedAtMs = nowMs()
    clearPendingTrailing(id)
    const attempt = this.attempts.get(id)
    if (attempt) {
      attempt.stopReason = 'canceled'
      attempt.abortController?.abort()
      this.engines.get(id)?.stop()
      await killProcessTree(attempt.child)
      await attempt.done
    }
    task.resumeChunks = undefined
    task.resumeDirectory = undefined
    await this.removeTaskFragments(task).catch(e => log.warn('[DM] Temp cleanup:', e))
    this.saveStateImmediate(id)
    sendUpdate(this.win, task)
    this.schedule()
    return task
  }

  async delete(id: string, deleteFile: boolean): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return
    await this.cancel(id)
    if (deleteFile) {
      for (const file of task.ownedFiles ?? []) {
        if (path.dirname(path.resolve(file)) !== path.resolve(task.directory)) continue
        await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') log.warn('[DM] Could not delete owned file:', error)
        })
      }
    }
    this.tasks.delete(id)
    this.runtime.delete(id)
    this.dirtyIds.delete(id)
    this.countedStats.delete(id)
    clearPendingTrailing(id)
    try { taskDb.deleteTask.run(id) } catch { log.error('DB delete failed') }
    this.schedule()
  }

  async clearCompleted(): Promise<void> {
    const completedIds = Array.from(this.tasks.values())
      .filter(t => t.status === 'completed' || t.status === 'canceled')
      .map(t => t.id)

    for (const id of completedIds) {
      const task = this.tasks.get(id)
      await this.attempts.get(id)?.done
      if (task) await this.removeTaskFragments(task).catch(e => log.warn('[DM] Temp cleanup:', e))
      this.tasks.delete(id)
      this.runtime.delete(id)
      this.countedStats.delete(id)
      this.dirtyIds.delete(id)
    }
    try { taskDb.clearCompleted.run() } catch { log.error('DB clearCompleted failed') }
  }

  /** Retry cleanup after shutdown interrupted a completed/canceled task's cleanup. */
  async cleanupSettledFragments(): Promise<void> {
    for (const task of this.tasks.values()) {
      if (task.status !== 'completed' && task.status !== 'canceled') continue
      await this.removeTaskFragments(task).catch(e => log.warn('[DM] Temp cleanup:', e))
    }
  }

  async pauseAll(): Promise<void> {
    this.pausingAll = true
    const activeIds = Array.from(this.tasks.values())
      .filter(t => t.status === 'downloading' || t.status === 'queued' || t.status === 'merging' || t.status === 'converting' || t.status === 'pausing')
      .map(t => t.id)

    try {
      for (const id of activeIds) await this.pause(id)
    } finally {
      this.pausingAll = false
    }
  }

  async resumeAll(): Promise<void> {
    const pausableIds = Array.from(this.tasks.values())
      .filter(t => t.status === 'paused' || t.status === 'error')
      .map(t => t.id)

    for (const id of pausableIds) {
      await this.resume(id)
    }
  }

  

  private detectEngine(url: string, targetFormat?: TargetFormat): DownloadEngine {
    const low = url.toLowerCase()
    if (
      low.includes('youtube.com') || low.includes('youtu.be') ||
      low.includes('facebook.com') || low.includes('instagram.com') ||
      low.includes('twitter.com') || low.includes('tiktok.com')
    ) return 'ytdlp'

    if (targetFormat && AUDIO_FORMATS.includes(targetFormat as AudioFormat)) {
      return 'ffmpeg'
    }
    return 'direct'
  }

  private mustGet(id: string): DownloadTask {
    const task = this.tasks.get(id)
    if (!task) throw new Error('Download task not found')
    return task
  }

  private reserveOutputPath(directory: string, filename: string, exceptId?: string): string {
    const parsed = path.parse(filename)
    let candidate = path.join(directory, filename)
    let suffix = 1
    const reserved = (filePath: string) => existsSync(filePath) ||
      Array.from(this.tasks.values()).some(t => t.id !== exceptId && t.filePath === filePath)
    while (reserved(candidate)) {
      candidate = path.join(directory, `${parsed.name}_${suffix++}${parsed.ext}`)
    }
    return candidate
  }

  private createContext(taskId: string, attempt: AttemptRuntime, draft: DownloadTask): EngineContext {
    const current = () => this.isCurrent(taskId, attempt)
    return {
      runtime: attempt,
      sendUpdate: t => {
        if (!current() || t !== draft) return
        const task = this.mustGet(taskId)
        const previousPhase = task.phase
        // Engines work on isolated drafts. Only this projection can reach authoritative state.
        for (const key of ['totalBytes', 'downloadedBytes', 'speedBytesPerSec', 'downloadPercent', 'convertingPercent', 'resumeChunks', 'supportsRanges', 'etag', 'lastModified', 'title', 'thumbnail', 'ytdlpStreams', 'ytdlpExpectedBytes', 'ytdlpExpectedStreamCount'] as const) {
          Object.assign(task, { [key]: t[key] })
        }
        if (t.status === 'merging' || t.status === 'converting') task.status = t.status
        task.phase = t.phase === 'trimming' || t.phase === 'validating' || t.phase === 'finalizing'
          ? t.phase : task.status === 'merging' || task.status === 'converting' ? task.status : 'downloading'
        task.updatedAtMs = nowMs()
        updateTaskProgress(task)
        if (task.phase !== previousPhase) {
          clearPendingTrailing(task.id)
          attempt.lastIpcAtMs = nowMs()
          sendUpdate(this.win, task)
        } else {
          throttledSendUpdate(this.win, task, attempt)
        }
        this.markDirty(taskId)
      },
      saveState: () => { if (current()) this.markDirty(taskId) },
      flushSave: () => { if (current()) this.saveStateImmediate(taskId) },
    }
  }

  private isCurrent(id: string, attempt: AttemptRuntime): boolean {
    const task = this.tasks.get(id)
    return this.attempts.get(id) === attempt && task?.attemptId === attempt.attemptId &&
      !attempt.stopReason && !attempt.abortController?.signal.aborted && task.status !== 'canceled'
  }

  private assertCurrent(id: string, attempt: AttemptRuntime): void {
    if (!this.isCurrent(id, attempt)) throw new Error('Attempt stopped or superseded')
  }

  /** Cancel task retry eligibility without touching an attempt's resources. */
  private clearRetryTimer(id: string): void {
    const timer = this.retryTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.retryTimers.delete(id)
    }
    const runtime = this.runtime.get(id)
    if (runtime) runtime.retryAt = undefined
  }

  /** Backoff never occupies a download slot; engines return an outcome immediately. */
  private scheduleRetry(id: string, delayMs: number): void {
    if (this.tasks.get(id)?.status !== 'queued') return
    this.clearRetryTimer(id)
    const runtime = this.runtime.get(id)
    if (runtime) runtime.retryAt = nowMs() + delayMs

    const timer = setTimeout(() => {
      this.retryTimers.delete(id)
      if (this.tasks.get(id)?.status !== 'queued') return
      const rt = this.runtime.get(id)
      if (rt) rt.retryAt = undefined
      this.schedule()
    }, delayMs)
    timer.unref?.()
    this.retryTimers.set(id, timer)
  }

  private schedule(): void {
    if (this.pausingAll) return
    const available = this.maxConcurrent - this.active.size
    if (available <= 0) return

    const now = nowMs()
    const candidates = Array.from(this.tasks.values())
      .filter(t => {
        if (t.status !== 'queued' || this.active.has(t.id) || this.attempts.has(t.id)) return false
        // Tasks awaiting a retry backoff are not eligible until it elapses
        // (see scheduleRetry) — they must not consume a concurrency slot.
        const retryAt = this.runtime.get(t.id)?.retryAt
        if (retryAt && retryAt > now) return false
        return true
      })
      .sort((a, b) => a.createdAtMs - b.createdAtMs)

    for (const task of candidates.slice(0, available)) {
      log.info(`[DM] Scheduling task ${task.id} engine=${task.engine}`)
      this.active.add(task.id)
      void this.executeEngine(task.id)
    }
  }

  private executeEngine(id: string): Promise<void> {
    const task = this.mustGet(id)
    if (task.status !== 'queued' || this.attempts.has(id)) return Promise.resolve()
    const previousRuntime = this.runtime.get(id)
    const attemptId = randomUUID()
    const attempt: AttemptRuntime = {
      ...this.freshRuntime(), retries: previousRuntime?.retries ?? 0,
      abortController: new AbortController(), attemptId,
      directory: path.join(task.directory, '.cortex_temp', task.id, attemptId),
    }
    this.runtime.set(id, attempt)
    this.attempts.set(id, attempt)
    this.active.add(id)
    task.attemptId = attemptId
    task.status = 'downloading'
    task.phase = 'preparing'
    task.overallProgress = null
    task.phaseProgress = null
    task.convertingPercent = undefined
    task.downloadPercent = undefined
    task.speedBytesPerSec = null
    clearPendingTrailing(id)
    sendUpdate(this.win, task)
    this.saveStateImmediate(id)
    // Publish the settlement promise before invoking any engine or async hook.
    attempt.done = Promise.resolve().then(() => this.runAttempt(task, attempt))
    return attempt.done
  }

  private async runAttempt(task: DownloadTask, attempt: AttemptRuntime): Promise<void> {
    const id = task.id
    const draft: DownloadTask = structuredClone(task)
    draft.directory = attempt.directory
    draft.filePath = path.join(attempt.directory, `${id}.${task.targetFormat}`)
    draft.ytdlpStreams = undefined
    const context = this.createContext(id, attempt, draft)
    try {
      await fs.mkdir(path.dirname(attempt.directory), { recursive: true })
      this.assertCurrent(id, attempt)
      // Transfer partial ownership only after the previous attempt has settled.
      const prior = task.resumeDirectory
      if (prior && path.dirname(path.resolve(prior)) === path.dirname(path.resolve(attempt.directory))) {
        await fs.rename(prior, attempt.directory).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
        this.assertCurrent(id, attempt)
      }
      await fs.mkdir(attempt.directory, { recursive: true })
      this.assertCurrent(id, attempt)
      task.resumeDirectory = attempt.directory
      this.saveStateImmediate(id)
      const entry = engines.get(task.engine)
      if (!entry) throw new Error(`No engine registered for '${task.engine}'`)
      const engine = entry.create()
      this.engines.set(id, engine)
      const result = await entry.start(engine, draft, context)
      this.assertCurrent(id, attempt)
      if (result.kind === 'success') {
        await this.finalize(task, draft, attempt, context, result.candidate)
      } else if (result.kind === 'retryable-error' && attempt.retries < (task.engine === 'ytdlp' ? 5 : 3)) {
        attempt.retries++
        task.status = 'queued'
        task.errorMessage = result.message
        this.scheduleRetry(id, result.delayMs)
      } else if (result.kind === 'paused' || result.kind === 'canceled') {
        task.status = result.kind
      } else {
        task.status = 'error'
        task.errorMessage = 'message' in result ? result.message : 'Engine failed'
      }
    } catch (error) {
      if (this.isCurrent(id, attempt)) {
        task.status = 'error'
        task.errorMessage = error instanceof Error ? error.message : String(error)
        log.error('[DM] Attempt failed:', error)
      }
    } finally {
      // Sockets/descriptors have settled in the engine before this point.
      await killProcessTree(attempt.child)
      attempt.child = null
      if (task.status === 'completed' || task.status === 'canceled') {
        task.resumeDirectory = undefined
        task.resumeChunks = undefined
        await this.removeTaskFragments(task).catch(e => log.warn('[DM] Temp cleanup:', e))
      }
      if (this.attempts.get(id) === attempt) {
        if (task.status === 'error' && this.isCurrent(id, attempt)) sendNotification('Download Failed', task.errorMessage || task.filename)
        if (attempt.stopReason === 'paused' && task.status === 'pausing') task.status = 'paused'
        if (task.status === 'paused' || task.status === 'queued' || task.status === 'error') {
          if (existsSync(attempt.directory)) task.resumeDirectory = attempt.directory
          task.resumeChunks = draft.resumeChunks
          task.etag = draft.etag
          task.lastModified = draft.lastModified
          task.supportsRanges = draft.supportsRanges
          task.downloadedBytes = draft.downloadedBytes
        }
        this.attempts.delete(id)
        this.engines.delete(id)
        this.active.delete(id)
        attempt.abortController = null
        clearPendingTrailing(id)
        task.speedBytesPerSec = null
        if (this.tasks.get(id) === task) {
          updateTaskProgress(task)
          this.saveStateImmediate(id)
          this.dirtyIds.delete(id)
          if (this.dirtyIds.size === 0 && this.writeBehindTimer) {
            clearInterval(this.writeBehindTimer)
            this.writeBehindTimer = null
          }
          sendUpdate(this.win, task)
        }
      }
      this.schedule()
    }
  }

  private async finalize(task: DownloadTask, draft: DownloadTask, attempt: AttemptRuntime, ctx: EngineContext, source: string): Promise<void> {
    const check = () => this.assertCurrent(task.id, attempt)
    if (path.dirname(path.resolve(source)) !== path.resolve(attempt.directory)) throw new Error('Candidate is not attempt-owned')
    const phase = (value: 'validating' | 'trimming' | 'converting' | 'merging' | 'finalizing') => {
      check()
      draft.phase = value
      draft.status = value === 'merging' ? 'merging' : value === 'trimming' || value === 'converting' ? 'converting' : draft.status
      draft.convertingPercent = undefined
      ctx.sendUpdate(draft)
    }
    phase('validating')
    const probe = await probeMediaFile(source, child => { attempt.child = child }, attempt.abortController!.signal)
    check()
    const bounds = trimBounds(task)
    const trimming = Boolean(task.startTime || task.endTime)
    const duration = Number(probe.format?.duration)
    let expectedDuration: number | undefined
    if (trimming) {
      if (!Number.isFinite(duration) || duration <= bounds.start) throw new Error('Trim start exceeds media duration')
      expectedDuration = Math.min(bounds.end ?? duration, duration) - bounds.start
    }
    let candidate = source
    if (trimming || !matchesMediaFormat(task.targetFormat, probe)) {
      const conversion = decideMediaConversion(task.targetFormat, probe, trimming)
      if (task.engine === 'ytdlp') youtubeDiagnostic('conversion', { decision: conversion, targetFormat: task.targetFormat, trimming })
      log.info(`[Finalize] ${task.id}: ${conversion} to ${task.targetFormat}`)
      phase(trimming ? 'trimming' : conversion === 'remux' ? 'merging' : 'converting')
      candidate = path.join(attempt.directory, `candidate.${task.targetFormat}`)
      const args = ['-i', source]
      if (trimming) args.push('-ss', String(bounds.start), '-t', String(expectedDuration))
      args.push(...mediaOutputArgs(task.targetFormat, candidate, probe, trimming))
      await runMediaProcess(args, draft, ctx, expectedDuration ?? (Number.isFinite(duration) ? duration : undefined))
      check()
    }
    phase('validating')
    const finalProbe = await probeMediaFile(candidate, child => { attempt.child = child }, attempt.abortController!.signal)
    if (task.engine === 'ytdlp') {
      const summarize = (streams: typeof probe.streams) => streams?.map(stream => ({ type: stream.codec_type, codec: stream.codec_name,
        width: stream.width, height: stream.height, fps: stream.avg_frame_rate, language: stream.tags?.language }))
      youtubeDiagnostic('output-validation', { source: summarize(probe.streams), final: summarize(finalProbe.streams) })
    }
    check()
    if (!matchesMediaFormat(task.targetFormat, finalProbe)) throw new Error(`Invalid ${task.targetFormat} container or codec`)
    if (task.engine === 'ytdlp' && task.subtitleLanguage && ['mp4', 'mkv', 'webm'].includes(task.targetFormat)
      && !finalProbe.streams?.some(stream => stream.codec_type === 'subtitle')) throw new Error('YOUTUBE_SUBTITLE_UNAVAILABLE')
    if (task.engine === 'ytdlp' && task.subtitleLanguage && !trimming) validateSubtitleMedia(probe, finalProbe, task.subtitleLanguage)
    const actualDuration = Number(finalProbe.format?.duration ?? finalProbe.streams?.find(s => s.duration)?.duration)
    if (expectedDuration !== undefined && (!Number.isFinite(actualDuration) || Math.abs(actualDuration - expectedDuration) > Math.max(0.25, Math.min(1, expectedDuration * 0.02)))) throw new Error('Trim duration failed validation')
    await validateMediaOutput(candidate, draft, ctx, Number.isFinite(actualDuration) && actualDuration > 0 ? actualDuration : undefined)
    check()
    const size = (await fs.stat(candidate)).size
    check()
    phase('finalizing')
    // Reserve again immediately before promotion; no overwrite of an unrelated file.
    const target = this.reserveOutputPath(task.directory, task.filename, task.id)
    check()
    // A hard-link promotion atomically publishes the validated bytes and refuses
    // an existing destination (rename can replace it). Candidate stays for rollback.
    await fs.link(candidate, target)
    const promoted = [target]
    try {
      check()
      const files = await fs.readdir(attempt.directory)
      check()
      for (const name of files) {
        if (!name.startsWith(`${task.id}.`) || !/\.(vtt|srt)$/i.test(name)) continue
        check()
        const subtitle = path.join(task.directory, path.parse(target).name + name.slice(task.id.length))
        try {
          await fs.link(path.join(attempt.directory, name), subtitle)
          promoted.push(subtitle)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
        check()
      }
    } catch (error) {
      for (const file of promoted) await fs.unlink(file).catch(e => log.error('[DM] Promotion rollback failed:', e))
      throw error
    }
    // No await between this guard and the authoritative commit.
    check()
    task.filePath = target
    task.filename = path.basename(target)
    task.ownedFiles = [...(task.ownedFiles ?? []), ...promoted]
    task.outputBytes = size
    task.validatedAttemptId = attempt.attemptId
    task.status = 'completed'
    task.phase = 'completed'
    task.updatedAtMs = nowMs()
    task.speedBytesPerSec = null
    task.errorMessage = null
    task.resumeChunks = undefined
    task.resumeDirectory = undefined
    attempt.retries = 0
    updateTaskProgress(task)
    this.saveStateImmediate(task.id)
    clearPendingTrailing(task.id)
    sendUpdate(this.win, task)
    if (!this.countedStats.has(task.id)) {
      this.countedStats.add(task.id)
      if (this.win && !this.win.isDestroyed()) this.win.webContents.send(STATS_CHANNEL, { id: task.id, addedBytes: size })
    }
    sendNotification('Download Complete', `${task.title || task.filename} downloaded successfully.`)
  }

  private async removeTaskFragments(task: DownloadTask): Promise<void> {
    if (!path.isAbsolute(task.directory) || !/^[\w-]+$/.test(task.id)) return
    const root = path.resolve(task.directory, '.cortex_temp')
    const owned = path.resolve(root, task.id)
    if (path.dirname(owned) !== root) throw new Error('Unsafe task temp directory')
    // Never follow a replaced temp root/junction into another directory.
    const rootStat = await fs.lstat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!rootStat) return
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Unsafe temp root')
    const realRoot = await fs.realpath(root)
    const realDirectory = await fs.realpath(task.directory)
    if (path.relative(realDirectory, realRoot) !== '.cortex_temp') throw new Error('Unsafe temp root')
    await fs.rm(owned, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    // Only remove the shared parent when empty; paused/active tasks keep it.
    await fs.rmdir(root).catch((error: NodeJS.ErrnoException) => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code || '')) throw error
    })
  }
}
