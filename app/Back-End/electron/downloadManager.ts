import { BrowserWindow } from 'electron'
import log from 'electron-log'
import {
  existsSync, readdirSync, unlinkSync
} from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { db, taskDb } from './db'
import type {
  DownloadTask, TaskRuntime, StartInput, EngineContext,
  DownloadEngine,
} from './types'
import { STATS_CHANNEL } from './types'
import {
  sanitizeFilename, ensureDirectoryExists, nowMs, isHttpUrl,
  withExtension, getDefaultFilename, sendUpdate, throttledSendUpdate,
  killProcessTree,
} from './utils'

// Engines
import type { IEngine } from './engines/IEngine'
import { DirectEngine } from './engines/DirectEngine'
import { YoutubeEngine } from './engines/YoutubeEngine'
import { FfmpegEngine } from './engines/FfmpegEngine'

type EngineEntry = {
  create: () => IEngine
  start: (engine: IEngine, task: DownloadTask, context: EngineContext) => Promise<void>
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
  private engines = new Map<string, IEngine>() // Track active engine instances
  private win: BrowserWindow | null = null
  private maxConcurrent = 3 // Concurrency limit
  private active = new Set<string>()

  constructor() {
    this.loadState()
  }

  // State Persistence
  private loadState(): void {
    try {
      // Load items from database ONLY
      const rows = taskDb.getAllTasks.all() as { full_payload: string }[]
      for (const row of rows) {
        try {
          const task: DownloadTask = JSON.parse(row.full_payload)
          if (!task.id || !task.url) continue
          // Reset active statuses on cold start
          if (task.status === 'downloading' || task.status === 'merging' || task.status === 'converting') {
            task.status = 'paused'
            task.speedBytesPerSec = null
          }
          this.tasks.set(task.id, task)
          this.runtime.set(task.id, this.freshRuntime())
        } catch (e) {
          log.error('Failed to parse task from DB row:', e)
        }
      }
      this.cleanupOrphanFiles()
    } catch (err) {
      log.error('Error loading tasks from DB:', err)
    }
  }

  /**
   * Scan download directories for orphaned {uuid}.* temp files left by
   * yt-dlp downloads that were interrupted by a crash.  Only deletes
   * files whose UUID prefix does NOT match any known task.
   */
  private cleanupOrphanFiles(): void {
    // Collect all known task IDs and all distinct directories
    const knownIds = new Set(this.tasks.keys())
    const directories = new Set<string>()
    for (const task of this.tasks.values()) {
      if (task.directory) directories.add(task.directory)
    }

    // UUID v4 pattern  at the start of a filename
    const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\./i

    for (const dir of directories) {
      try {
        if (!existsSync(dir)) continue
        const files = readdirSync(dir)
        for (const file of files) {
          const match = UUID_RE.exec(file)
          if (!match) continue
          const fileId = match[1]
          if (knownIds.has(fileId)) continue // belongs to an active task
          const orphanPath = path.join(dir, file)
          try {
            unlinkSync(orphanPath)
            log.info(`[Cleanup] Deleted orphan: ${file}`)
          } catch { /* in-use or permission — skip */ }
        }
      } catch { /* directory read failed — skip */ }
    }
  }

  /**
   * Save active tasks to database.
   */
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
    taskDb.upsertTask.run({
      id: t.id,
      title: t.title || t.filename,
      url: t.url,
      status: t.status,
      progress: Math.min(100, Math.round(((t.downloadedBytes || 0) / (t.totalBytes || 1)) * 100)) || 0,
      size: t.totalBytes || 0,
      thumbnail: t.thumbnail || '',
      engine: t.engine,
      full_payload: JSON.stringify(t)
    })
  }

  /**
   * Update active tasks in database.
   */
  private saveStateDebounced(): void {
    // With WAL mode SQLite, we can just do it instantly. 
    // We only update active tasks here to save cycles.
    try {
      const trans = db.transaction((activeIds: string[]) => {
        for (const id of activeIds) {
          const t = this.tasks.get(id)
          if (t) this.upsertTaskToDb(t)
        }
      })
      trans(Array.from(this.active))
    } catch (e) {
      log.error('DB debounced save error', e)
    }
  }

  /**
   * Used before app quit so the last state isn't lost.
   */
  flushPendingSave(): void {
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

  // Public API
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
    if (!isHttpUrl(input.url)) {
      throw new Error('URL must be http or https')
    }
    // Apply optional subfolder (sanitized to prevent directory traversal)
    const rawSubfolder = (input.subfolderName ?? '').trim()
    // eslint-disable-next-line no-useless-escape
    const safeSubfolder = rawSubfolder.replace(/[\/\\:*?"<>|]/g, '').trim()
    const finalDirectory = safeSubfolder
      ? path.join(input.directory, safeSubfolder)
      : input.directory
    await ensureDirectoryExists(finalDirectory)

    const id = randomUUID()
    const targetFormat = input.targetFormat ?? 'mp4'
    const requestedEngine = input.engine ?? 'auto'
    const engine: DownloadEngine =
      requestedEngine === 'auto'
        ? this.detectEngine(input.url)
        : requestedEngine

    // Build safe filename
    let filename = sanitizeFilename(input.filename || input.title || getDefaultFilename(input.url))
    filename = filenameTransforms[engine]?.(filename) ?? filename
    filename = withExtension(filename, targetFormat)

    const filePath = path.join(finalDirectory, filename)
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
      cookieBrowser: input.cookieBrowser,
      cookieFile: input.cookieFile,
      username: input.username,
      password: input.password,
      speedLimit: input.speedLimit,
      startTime: input.startTime,
      endTime: input.endTime,
      ytdlpFormatId: input.ytdlpFormatId,
    }

    this.tasks.set(id, task)
    this.runtime.set(id, this.freshRuntime())
    this.saveStateImmediate()
    log.info(`[DM] Task added: ${id} engine=${engine} format=${targetFormat} url=${input.url.slice(0, 60)}`)
    sendUpdate(this.win, task)
    this.schedule()
    return task
  }

  async pause(id: string): Promise<DownloadTask> {
    const task = this.mustGet(id)
    const isPauseable = task.status === 'downloading'
      || task.status === 'merging'
      || task.status === 'converting'
    if (!isPauseable) return task

    const engine = this.engines.get(id)
    if (engine) {
      engine.pause()
      this.engines.delete(id)
    }

    const runtime = this.mustGetRuntime(id)
    runtime.abortController?.abort()
    killProcessTree(runtime.child)

    task.status = 'paused'
    task.updatedAtMs = nowMs()
    task.speedBytesPerSec = null
    this.saveStateImmediate()
    sendUpdate(this.win, task)
    this.active.delete(id) // Ensure it's removed from active set
    this.schedule()
    return task
  }

  async resume(id: string): Promise<DownloadTask> {
    const task = this.mustGet(id)
    // Ignore tasks that are already active or terminal
    if (
      task.status === 'completed' || task.status === 'canceled' ||
      task.status === 'downloading' || task.status === 'merging' ||
      task.status === 'converting' || task.status === 'queued'
    ) return task

    task.errorMessage = null
    task.status = 'queued'
    task.updatedAtMs = nowMs()
    this.saveStateImmediate()
    sendUpdate(this.win, task)
    this.schedule()
    return task
  }

  async cancel(id: string): Promise<DownloadTask> {
    const task = this.mustGet(id)
    const runtime = this.mustGetRuntime(id)

    const engine = this.engines.get(id)
    if (engine) {
      engine.stop()
      this.engines.delete(id)
    }

    runtime.abortController?.abort()
    killProcessTree(runtime.child)

    task.status = 'canceled'
    task.updatedAtMs = nowMs()
    task.speedBytesPerSec = null
    this.saveStateImmediate()
    sendUpdate(this.win, task)
    this.active.delete(id)
    this.schedule()

    // Clean up partial file
    await delay(100)
    try {
      if (existsSync(task.filePath)) await fs.unlink(task.filePath)
    } catch { /* ignore cleanup errors */ }

    return task
  }

  async delete(id: string, deleteFile: boolean): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return

    // Stop active download first
    const runtime = this.runtime.get(id)
    if (runtime) {
      runtime.abortController?.abort()
      killProcessTree(runtime.child)
      this.runtime.delete(id)
    }

    // Delete physical file if requested
    if (deleteFile && task.filePath) {
      try {
        if (existsSync(task.filePath)) {
          await fs.unlink(task.filePath)
        }
      } catch (err: unknown) {
        if (err instanceof Error && (err as any).code !== 'ENOENT') {
          const isLocked = (err as any).code === 'EBUSY' || (err as any).code === 'EPERM' || (err as any).code === 'EACCES'
          throw new Error(
            isLocked
              ? 'File is currently in use. Close any player or app using it, then try again.'
              : `Failed to delete file: ${err.message}`
          )
        }
      }
    }

    this.tasks.delete(id)
    this.active.delete(id)
    try { taskDb.deleteTask.run(id) } catch { log.error('DB delete failed') }
    this.schedule()
  }

  async clearCompleted(): Promise<void> {
    const completedIds = Array.from(this.tasks.values())
      .filter(t => t.status === 'completed' || t.status === 'canceled')
      .map(t => t.id)

    for (const id of completedIds) {
      this.tasks.delete(id)
      this.runtime.delete(id)
    }
    try { taskDb.clearCompleted.run() } catch { log.error('DB clearCompleted failed') }
  }

  async pauseAll(): Promise<void> {
    const activeIds = Array.from(this.tasks.values())
      .filter(t => t.status === 'downloading' || t.status === 'queued')
      .map(t => t.id)

    for (const id of activeIds) {
      await this.pause(id)
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

  // Internals

  private detectEngine(url: string): DownloadEngine {
    const low = url.toLowerCase()
    if (
      low.includes('youtube.com') || low.includes('youtu.be') ||
      low.includes('facebook.com') || low.includes('instagram.com') ||
      low.includes('twitter.com') || low.includes('tiktok.com')
    ) return 'ytdlp'
    return 'direct'
  }

  private mustGet(id: string): DownloadTask {
    const task = this.tasks.get(id)
    if (!task) throw new Error('Download task not found')
    return task
  }

  private mustGetRuntime(id: string): TaskRuntime {
    const rt = this.runtime.get(id)
    if (!rt) throw new Error('Task runtime not found')
    return rt
  }

  private createContext(taskId: string): EngineContext {
    const runtime = this.mustGetRuntime(taskId)
    return {
      sendUpdate: (t) => {
        let shouldUpdateDb = true
        if (runtime) {
          shouldUpdateDb = throttledSendUpdate(this.win, t, runtime)
        } else {
          sendUpdate(this.win, t)
        }

        // Only write to SQLite when UI is updated (throttled to 5 times/sec) to avoid DB lock/CPU spike
        if (shouldUpdateDb) {
          try {
            taskDb.updateStatusAndProgress.run({
              id: t.id,
              status: t.status,
              progress: Math.min(100, Math.round(((t.downloadedBytes || 0) / (t.totalBytes || 1)) * 100)) || 0,
              full_payload: JSON.stringify(t)
            })
          } catch (dbErr) {
            log.error('DB Update Error:', dbErr)
          }
        }
      },
      runtime,
      saveState: () => this.saveStateDebounced(),
      flushSave: () => this.saveStateImmediate(taskId),
      sendStats: (id, addedBytes) => {
        if (this.win && !this.win.isDestroyed()) {
          this.win.webContents.send(STATS_CHANNEL, { id, addedBytes })
        }
      },
    }
  }

  // Queue Scheduler
  private schedule(): void {
    const available = this.maxConcurrent - this.active.size
    if (available <= 0) return

    const candidates = Array.from(this.tasks.values())
      .filter(t => t.status === 'queued' && !this.active.has(t.id))
      .sort((a, b) => a.createdAtMs - b.createdAtMs)

    for (const task of candidates.slice(0, available)) {
      log.info(`[DM] Scheduling task ${task.id} engine=${task.engine}`)
      this.active.add(task.id)
      void this.executeEngine(task.id)
    }
  }

  private async executeEngine(id: string): Promise<void> {
    const task = this.mustGet(id)

    if (task.status !== 'queued') {
      this.active.delete(id)
      this.schedule()
      return
    }

    log.info(`[DM] Executing engine '${task.engine}' for task ${id}`)
    try {
      task.status = 'downloading'
      task.updatedAtMs = nowMs()
      sendUpdate(this.win, task)
      
      const entry = engines.get(task.engine)
      if (!entry) throw new Error(`[DM] No engine registered for '${task.engine}'`)

      const engine = entry.create()
      this.engines.set(id, engine)

      // Create context for the engine to report progress and update state
      const context = this.createContext(id)

      await entry.start(engine, task, context)
      this.engines.delete(id)

      // Post-download processing (e.g., merging for High-Res Youtube)
      // If task requires merge, we could call this.mediaProcessor.merge(...) here.

      // If the user paused/canceled the task while the engine was running,
      // the engine should not overwrite that state with "completed".
      if (task.status === 'downloading' || task.status === 'merging' || task.status === 'converting') {
        task.status = 'completed'
        task.updatedAtMs = nowMs()
        log.info(`[DM] Task ${id} completed successfully`)
      }

    } catch (err: unknown) {
      log.error(`[DM] Task ${id} failed:`, err)
      task.status = 'error'
      task.errorMessage = err instanceof Error ? err.message : 'Unknown engine error'
      this.engines.delete(id)
    } finally {
      this.active.delete(id)
      this.saveStateImmediate(id)
      sendUpdate(this.win, task)
      this.schedule()
    }
  }
}

