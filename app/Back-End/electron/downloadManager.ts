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
  DownloadEngine, AudioFormat, TargetFormat,
} from './types'
import { STATS_CHANNEL, YOUTUBE_OAUTH_CHANNEL, AUDIO_FORMATS } from './types'
import {
  sanitizeFilename, ensureDirectoryExists, nowMs, isHttpUrl,
  withExtension, getDefaultFilename, sendUpdate, throttledSendUpdate,
  killProcessTree, flushPendingIpc,
} from './utils'

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
  private engines = new Map<string, IEngine>() 
  private win: BrowserWindow | null = null
  private maxConcurrent = 3
  private active = new Set<string>()

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

  

  private cleanupOrphanFiles(): void {
    
    const knownIds = new Set(this.tasks.keys())
    const directories = new Set<string>()
    for (const task of this.tasks.values()) {
      if (task.directory) directories.add(task.directory)
    }

    
    const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\./i

    for (const dir of directories) {
      try {
        if (!existsSync(dir)) continue
        const files = readdirSync(dir)
        for (const file of files) {
          const match = UUID_RE.exec(file)
          if (!match) continue
          const fileId = match[1]
          if (knownIds.has(fileId)) continue 
          const orphanPath = path.join(dir, file)
          try {
            unlinkSync(orphanPath)
            log.info(`[Cleanup] Deleted orphan: ${file}`)
          } catch {
            
          }
        }
      } catch {
        
      }
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

  

  private saveStateDebounced(): void {
    
    
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
    const created: DownloadTask[] = []
    for (const input of inputs) {
      if (!isHttpUrl(input.url)) continue

      const rawSubfolder = (input.subfolderName ?? '').trim()
      
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
          ? this.detectEngine(input.url, targetFormat)
          : requestedEngine

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
      
      
      setTimeout(() => this.schedule(), 100)
    }
    return created
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
    await killProcessTree(runtime.child)

    task.status = 'paused'
    task.updatedAtMs = nowMs()
    task.speedBytesPerSec = null
    this.saveStateImmediate()
    sendUpdate(this.win, task)
    this.active.delete(id) 
    this.schedule()
    return task
  }

  async resume(id: string): Promise<DownloadTask> {
    const task = this.mustGet(id)
    
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
    await killProcessTree(runtime.child)

    task.status = 'canceled'
    task.updatedAtMs = nowMs()
    task.speedBytesPerSec = null
    this.saveStateImmediate()
    sendUpdate(this.win, task)
    this.active.delete(id)
    this.schedule()

    
    await delay(100)
    try {
      if (existsSync(task.filePath)) await fs.unlink(task.filePath)
    } catch {
      
    }

    return task
  }

  async delete(id: string, deleteFile: boolean): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return

    const runtime = this.runtime.get(id)
    if (runtime) {
      runtime.abortController?.abort()
      await killProcessTree(runtime.child)
      this.runtime.delete(id)
    }

    if (deleteFile) {
      const pathsToDelete = new Set<string>()

      if (task.filePath) {
        pathsToDelete.add(task.filePath)
      }

      if (task.directory && existsSync(task.directory)) {
        try {
          const files = await fs.readdir(task.directory)
          const baseNameNoExt = task.filePath ? path.parse(task.filePath).name : ''
          const titleBase = task.title ? sanitizeFilename(task.title) : ''

          for (const f of files) {
            const fPath = path.join(task.directory, f)
            const fNameNoExt = path.parse(f).name

            if (
              f.startsWith(`${task.id}.`) ||
              (baseNameNoExt && (fNameNoExt === baseNameNoExt || fNameNoExt.startsWith(`${baseNameNoExt}_`))) ||
              (titleBase && (fNameNoExt === titleBase || fNameNoExt.startsWith(`${titleBase}_`)))
            ) {
              pathsToDelete.add(fPath)
            }
          }
        } catch (err) {
          log.warn(`[DownloadManager] Directory scan error during delete:`, err)
        }
      }

      for (const p of pathsToDelete) {
        if (!existsSync(p)) continue
        let unlinked = false
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await fs.unlink(p)
            unlinked = true
            break
          } catch (err: any) {
            if (err?.code === 'ENOENT') {
              unlinked = true
              break
            }
            log.warn(`[DownloadManager] Attempt ${attempt + 1} failed to delete ${p}: ${err?.message}`)
            await delay(200)
          }
        }
        if (!unlinked && existsSync(p)) {
          log.error(`[DownloadManager] Failed to delete file: ${p}`)
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
      sendYouTubeOAuthCode: (payload) => {
        if (this.win && !this.win.isDestroyed()) {
          this.win.webContents.send(YOUTUBE_OAUTH_CHANNEL, payload)
        }
      },
    }
  }

  
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

      
      const context = this.createContext(id)

      await entry.start(engine, task, context)
      this.engines.delete(id)

      
      

      
      
      if (task.status === 'downloading' || task.status === 'merging' || task.status === 'converting') {
        // Flush any trailing throttled IPC update so the renderer receives
        // the final progress snapshot before the completion event.
        flushPendingIpc(task.id)
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
