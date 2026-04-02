/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Download Manager — Clean orchestrator for the download queue.
 *
 *  Responsibilities:
 *  - Task lifecycle (add, pause, resume, cancel, delete)
 *  - Concurrent download queue (max 2 simultaneous downloads)
 *  - Persistent state (tasks.json in userData)
 *  - Engine dispatch (delegates actual downloading to engine modules)
 *
 *  All download logic lives in dedicated engine modules:
 *  - directEngine.ts  → HTTP direct downloads
 *  - ffmpegEngine.ts  → HLS/M3U8 + audio extraction
 *  - ytdlpEngine.ts   → YouTube, social media, etc.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { BrowserWindow, app } from 'electron'
import {
  existsSync, readFileSync, readdirSync, unlinkSync, renameSync
} from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { db, taskDb } from './db'
import type {
  DownloadTask, TaskRuntime, StartInput, EngineContext,
  DownloadEngine, AudioFormat,
} from './types'
import { AUDIO_FORMATS, STATS_CHANNEL } from './types'
import {
  sanitizeFilename, ensureDirectoryExists, nowMs, isHttpUrl, isM3u8Url,
  withExtension, getDefaultFilename, sendUpdate, throttledSendUpdate,
  killProcessTree,
} from './utils'
import { runDirectDownload } from './directEngine'
import { runFfmpegDownload } from './ffmpegEngine'
import { runYtdlpDownload } from './ytdlpEngine'

// Re-export for backward compatibility (used by main.ts check-engines handler)
export { isFfmpegAvailable } from './ffmpegEngine'

export class DownloadManager {
  private tasks = new Map<string, DownloadTask>()
  private runtime = new Map<string, TaskRuntime>()
  private win: BrowserWindow | null = null
  private maxConcurrent = 3
  // Default concurrency limit — set to 3 to keep parallel downloads reasonable.
  // Default concurrency limit — keep low to avoid server throttling and UI load.
  // Set to 3 as a safe default per user request.
  // Note: schedule() enforces this limit strictly by using this.active.size.
  // Adjusting at runtime would require a setter and re-scheduling logic.
  // For now, the default is set to 3.
  private active = new Set<string>()
  private storagePath: string

  constructor() {
    this.storagePath = path.join(app.getPath('userData'), 'tasks.json')
    this.loadState()
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  State Persistence
  // ═══════════════════════════════════════════════════════════════════════

  private loadState(): void {
    try {
      console.log('Loading tasks from SQLite (Phase 1 Migration Ready if needed)')
      // First, migrate if tasks.json exists and we haven't done it yet
      this.migrateFromJson()

      // Load items from database
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
          console.error('Failed to parse task from DB row:', e)
        }
      }
      console.log(`Loaded ${this.tasks.size} tasks successfully from database`)
      this.cleanupOrphanFiles()
    } catch (err) {
      console.error('Error loading tasks from DB:', err)
    }
  }

  /**
   * Migrate old tasks.json file to the robust SQLite database.
   */
  private migrateFromJson() {
    if (!existsSync(this.storagePath)) return
    
    console.log('Old tasks.json detected. Migrating to SQLite...')
    try {
      const data = readFileSync(this.storagePath, 'utf-8')
      const rawTasks: DownloadTask[] = JSON.parse(data)
      if (Array.isArray(rawTasks)) {
        const trans = db.transaction((tasks: DownloadTask[]) => {
          for (const t of tasks) {
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
        })
        trans(rawTasks)
        console.log(`Migrated ${rawTasks.length} tasks to SQLite! Renaming tasks.json out of the way.`)
        // Rename the old file so we don't migrate again on restart
        renameSync(this.storagePath, this.storagePath + '.bak')
      }
    } catch (e) {
      console.error('Migration failed:', e)
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
            console.log(`[Cleanup] Deleted orphan: ${file}`)
          } catch { /* in-use or permission — skip */ }
        }
      } catch { /* directory read failed — skip */ }
    }
  }

  /**
   * Instantly update active tasks to the database. Phase 1 SQLite integration.
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
      console.error('Failed to save tasks to SQLite:', err)
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
   * Debounced save is largely obsolete with SQLite WAL, but kept for interface compatibility
   * until engines are refactored to stop calling it.
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
      console.error('DB debounced save error', e)
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

  // ═══════════════════════════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════════════════════════

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
    const safeSubfolder = rawSubfolder.replace(/[\/\\:*?"<>|]/g, '').trim()
    const finalDirectory = safeSubfolder
      ? path.join(input.directory, safeSubfolder)
      : input.directory
    await ensureDirectoryExists(finalDirectory)

    const id = randomUUID()
    const targetFormat = input.targetFormat ?? 'mp4'
    const requestedEngine = input.engine ?? 'auto'
    const isAudioFormat = AUDIO_FORMATS.includes(targetFormat as AudioFormat)

    const engine: DownloadEngine =
      requestedEngine === 'auto'
        ? this.detectEngine(input.url, isAudioFormat)
        : requestedEngine

    // Build safe filename
    let filename = sanitizeFilename(input.filename || input.title || getDefaultFilename(input.url))
    if (engine === 'ytdlp') filename = filename.replace(/\s+/g, '_')
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
    console.log(`[DM] Task added: ${id} engine=${engine} format=${targetFormat} url=${input.url.slice(0, 60)}`)
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

    const runtime = this.mustGetRuntime(id)
    runtime.abortController?.abort()
    killProcessTree(runtime.child)

    task.status = 'paused'
    task.updatedAtMs = nowMs()
    task.speedBytesPerSec = null
    this.saveStateImmediate()
    sendUpdate(this.win, task)
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
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          const isLocked = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES'
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
    try { taskDb.deleteTask.run(id) } catch { console.error('DB delete failed') }
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
    try { taskDb.clearCompleted.run() } catch { console.error('DB clearCompleted failed') }
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

  // ═══════════════════════════════════════════════════════════════════════
  //  Internals
  // ═══════════════════════════════════════════════════════════════════════

  private detectEngine(url: string, isAudioFormat: boolean): DownloadEngine {
    const low = url.toLowerCase()
    if (
      low.includes('youtube.com') || low.includes('youtu.be') ||
      low.includes('facebook.com') || low.includes('instagram.com')
    ) return 'ytdlp'
    if (isM3u8Url(url) || isAudioFormat) return 'ffmpeg'
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
    return {
      sendUpdate: (t) => {
        const rt = this.runtime.get(taskId)
        if (rt) throttledSendUpdate(this.win, t, rt)
        else sendUpdate(this.win, t)
        
        // Instantly write to SQLite on each progress tick (fast via WAL)
        try {
          taskDb.updateStatusAndProgress.run({
            id: t.id,
            status: t.status,
            progress: Math.min(100, Math.round(((t.downloadedBytes || 0) / (t.totalBytes || 1)) * 100)) || 0,
            full_payload: JSON.stringify(t)
          })
        } catch (dbErr) {
          console.error('DB Update Error:', dbErr)
        }
      },
      saveState: () => this.saveStateDebounced(),
      flushSave: () => this.saveStateImmediate(taskId),
      sendStats: (id, addedBytes) => {
        if (this.win && !this.win.isDestroyed()) {
          this.win.webContents.send(STATS_CHANNEL, { id, addedBytes })
        }
      },
    }
  }

  // ── Queue Scheduler ────────────────────────────────────────────────────

  private schedule(): void {
    const available = this.maxConcurrent - this.active.size
    if (available <= 0) return

    const candidates = Array.from(this.tasks.values())
      .filter(t => t.status === 'queued' && !this.active.has(t.id))
      .sort((a, b) => a.createdAtMs - b.createdAtMs)

    for (const task of candidates.slice(0, available)) {
      console.log(`[DM] Scheduling task ${task.id} engine=${task.engine}`)
      this.active.add(task.id)
      void this.executeEngine(task.id)
    }
  }

  private async executeEngine(id: string): Promise<void> {
    const task = this.mustGet(id)
    const runtime = this.mustGetRuntime(id)

    if (task.status !== 'queued') {
      this.active.delete(id)
      this.schedule()
      return
    }

    console.log(`[DM] Executing engine '${task.engine}' for task ${id}`)
    try {
      const ctx = this.createContext(task.id)
      switch (task.engine) {
        case 'direct':  await runDirectDownload(task, runtime, ctx); break
        case 'ffmpeg':  await runFfmpegDownload(task, runtime, ctx); break
        case 'ytdlp':   await runYtdlpDownload(task, runtime, ctx); break
      }
      console.log(`[DM] Engine '${task.engine}' finished for task ${id} → status=${task.status}`)
    } catch (err) {
      // Catches errors that escape the individual engine's own try/catch
      console.error(`[DM] Engine '${task.engine}' threw unexpectedly for task ${id}:`, err)
      task.status = 'error'
      task.errorMessage = err instanceof Error ? err.message : 'Unexpected engine error'
      task.updatedAtMs = nowMs()
      try { this.saveStateImmediate() } catch { /* ignore */ }
      sendUpdate(this.win, task)
    } finally {
      runtime.abortController = null
      runtime.child = null
      this.active.delete(id)
      this.schedule()
    }
  }
}
