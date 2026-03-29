/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Download Store — Single source of truth for all download tasks.
 *
 *  Architecture: Zustand normalized Map store with per-task subscriptions.
 *  This means when task X updates, ONLY <DownloadCard id={X}> re-renders.
 *  The task list itself only re-renders when tasks are added/removed.
 *
 *  IPC wiring is done via initDownloadStore() — called once at app startup.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { create } from 'zustand'

// ── C# ↔ Frontend Payload Mapping ───────────────────────────────────────────
//
// The C# backend serialises DownloadProgress with PascalCase properties and a
// numeric DownloadPhase enum.  This normaliser bridges that gap so the rest of
// the React layer can keep using the camelCase DownloadTask shape.

/** C# DownloadPhase enum → frontend DownloadStatus string */
const PHASE_TO_STATUS: Record<number, DownloadStatus> = {
  0: 'downloading', // Extracting
  1: 'downloading', // Downloading
  2: 'merging',     // Merging
  3: 'completed',   // Complete
  4: 'error',       // Error
}

/**
 * Accept a raw IPC payload (PascalCase from C# **or** camelCase from the
 * existing Electron download-manager) and return a well-formed DownloadTask.
 *
 * For progress-only updates the function merges into whichever task already
 * exists in the store so that identity / metadata fields aren't lost.
 */
function normalizePayload(
  raw: Record<string, any>,
  existing?: DownloadTask,
): DownloadTask | null {
  // Fast path – already camelCase with a string status
  // IMPORTANT: Still spread to create a new reference. The Electron DownloadManager
  // mutates and re-sends the SAME object, so without cloning Zustand's Object.is()
  // check sees no change and skips the React re-render.
  if (raw.id && typeof raw.status === 'string') return { ...raw } as DownloadTask

  const id: string | undefined = raw.Id ?? raw.id
  if (!id) return null

  // Map Phase enum → status string
  let status: DownloadStatus
  if (typeof raw.Phase === 'number') {
    status = PHASE_TO_STATUS[raw.Phase] ?? 'downloading'
  } else {
    status = raw.Status ?? raw.status ?? existing?.status ?? 'downloading'
  }

  return {
    id,
    url:              raw.Url             ?? raw.url             ?? existing?.url            ?? '',
    directory:        raw.Directory       ?? raw.directory       ?? existing?.directory      ?? '',
    filename:         raw.Filename        ?? raw.filename        ?? existing?.filename       ?? '',
    filePath:         raw.FilePath        ?? raw.filePath        ?? existing?.filePath       ?? '',
    engine:           raw.Engine          ?? raw.engine          ?? existing?.engine         ?? 'direct',
    targetFormat:     raw.TargetFormat    ?? raw.targetFormat    ?? existing?.targetFormat   ?? 'mp4',
    title:            raw.Title           ?? raw.title           ?? existing?.title,
    thumbnail:        raw.Thumbnail       ?? raw.thumbnail       ?? existing?.thumbnail,
    cookieBrowser:    raw.CookieBrowser   ?? raw.cookieBrowser   ?? existing?.cookieBrowser,
    startTime:        raw.StartTime       ?? raw.startTime       ?? existing?.startTime,
    endTime:          raw.EndTime         ?? raw.endTime         ?? existing?.endTime,
    errorMessage:     raw.ErrorMessage    ?? raw.errorMessage    ?? existing?.errorMessage   ?? null,
    createdAtMs:      raw.CreatedAtMs     ?? raw.createdAtMs     ?? existing?.createdAtMs    ?? Date.now(),
    updatedAtMs:      raw.UpdatedAtMs     ?? raw.updatedAtMs     ?? Date.now(),

    // Core progress fields (the C# DownloadProgress record)
    status,
    totalBytes:        raw.TotalBytes        ?? raw.totalBytes        ?? existing?.totalBytes        ?? null,
    downloadedBytes:   raw.DownloadedBytes   ?? raw.downloadedBytes   ?? existing?.downloadedBytes   ?? 0,
    speedBytesPerSec:  raw.SpeedBytesPerSec  ?? raw.speedBytesPerSec  ?? existing?.speedBytesPerSec  ?? null,
    convertingPercent: raw.Percentage != null && status === 'merging'
      ? raw.Percentage
      : raw.ConvertingPercent ?? raw.convertingPercent ?? existing?.convertingPercent,
    downloadPercent: raw.DownloadPercent ?? raw.downloadPercent ?? existing?.downloadPercent,
  }
}

// ── Store Shape ──────────────────────────────────────────────────────────────

interface DownloadStoreState {
  /** Normalized tasks — fast O(1) lookup by ID */
  tasks: Map<string, DownloadTask>

  /** Ordered list of task IDs (newest first) */
  taskIds: string[]

  /** Upsert a single task (insert or update-in-place) */
  upsertTask: (task: DownloadTask) => void

  /** Remove a task by ID */
  removeTask: (id: string) => void

  /** Bulk-load from the initial IPC list call */
  loadTasks: (tasks: DownloadTask[]) => void

  /** Remove all completed/canceled/error tasks */
  clearCompleted: () => void
}

export const useDownloadStore = create<DownloadStoreState>((set) => ({
  tasks: new Map(),
  taskIds: [],

  upsertTask: (task) =>
    set((state) => {
      const isNew = !state.tasks.has(task.id)
      const next = new Map(state.tasks)
      next.set(task.id, task)
      return {
        tasks: next,
        taskIds: isNew ? [task.id, ...state.taskIds] : state.taskIds,
      }
    }),

  removeTask: (id) =>
    set((state) => {
      const next = new Map(state.tasks)
      next.delete(id)
      return {
        tasks: next,
        taskIds: state.taskIds.filter((tid) => tid !== id),
      }
    }),

  loadTasks: (tasks) =>
    set(() => {
      const map = new Map<string, DownloadTask>()
      const ids: string[] = []
      for (const t of tasks) {
        map.set(t.id, t)
        ids.push(t.id)
      }
      return { tasks: map, taskIds: ids }
    }),

  clearCompleted: () =>
    set((state) => {
      const next = new Map<string, DownloadTask>()
      const nextIds: string[] = []
      for (const id of state.taskIds) {
        const t = state.tasks.get(id)
        if (t && t.status !== 'completed' && t.status !== 'canceled') {
          next.set(id, t)
          nextIds.push(id)
        }
      }
      return { tasks: next, taskIds: nextIds }
    }),
}))

// ── Selectors (equality-stable, used by components) ──────────────────────────

/** Select a single task by ID — only re-renders when THAT task changes. */
export const useTask = (id: string) =>
  useDownloadStore((s) => s.tasks.get(id))

/** Select ordered task IDs — only re-renders when IDs array changes. */
export const useTaskIds = () =>
  useDownloadStore((s) => s.taskIds)

/** Get the full tasks map without subscribing (for imperative reads). */
export const getTasksSnapshot = () =>
  useDownloadStore.getState().tasks

// ── IPC Wiring — call once at app startup ────────────────────────────────────

let ipcInitialized = false

export function initDownloadStore(): () => void {
  if (ipcInitialized) return () => {}
  ipcInitialized = true

  const { upsertTask, loadTasks } = useDownloadStore.getState()

  // 1. Load the initial task list from the main process
  window.cortexDl.listDownloads().then((initial) => {
    const normalised = (initial as any[])
      .map((raw) => normalizePayload(raw))
      .filter((t): t is DownloadTask => t !== null)
    loadTasks(normalised)
  })

  // 2. Subscribe to real-time task updates from main process.
  //    CRITICAL: The Electron DownloadManager sends the same mutable object reference
  //    every tick. We MUST shallow-clone ({ ...task }) so Zustand sees a new reference
  //    and triggers a React re-render. Without this, Object.is() returns true and the
  //    UI never updates.
  const disposeUpdated = window.cortexDl.onDownloadUpdated((raw: any) => {
    const existing = useDownloadStore.getState().tasks.get(raw.Id ?? raw.id)
    const task = normalizePayload(raw, existing)
    if (!task) return
    // Force a new object reference so Zustand's equality check sees a change
    upsertTask({ ...task })
    console.debug('[IPC:updated]', task.id, 'status=', task.status,
      'bytes=', task.downloadedBytes, '/', task.totalBytes,
      'speed=', task.speedBytesPerSec)
  })

  // 3. Subscribe to lightweight progress ticks (C# backend or any secondary channel).
  //    Channel: 'cortexdl:download-progress'
  const disposeProgress = window.cortexDl.onDownloadProgress((raw: any) => {
    const id: string | undefined = raw.Id ?? raw.id
    if (!id) return

    const existing = useDownloadStore.getState().tasks.get(id)
    if (!existing) return

    let status: DownloadStatus = existing.status
    if (typeof raw.Phase === 'number') {
      status = PHASE_TO_STATUS[raw.Phase] ?? existing.status
    }

    // Always create a fresh object so Zustand triggers re-render
    const updated: DownloadTask = {
      ...existing,
      status,
      totalBytes:       raw.TotalBytes       ?? raw.totalBytes       ?? existing.totalBytes,
      downloadedBytes:  raw.DownloadedBytes  ?? raw.downloadedBytes  ?? existing.downloadedBytes,
      speedBytesPerSec: raw.SpeedBytesPerSec ?? raw.speedBytesPerSec ?? existing.speedBytesPerSec,
      updatedAtMs:      Date.now(),
    }

    if (raw.Percentage != null && (status === 'merging' || status === 'converting')) {
      updated.convertingPercent = raw.Percentage
    }

    upsertTask(updated)
    console.debug('[IPC:progress]', id, 'status=', status,
      'bytes=', updated.downloadedBytes, '/', updated.totalBytes,
      'speed=', updated.speedBytesPerSec)
  })

  return () => {
    disposeUpdated()
    disposeProgress()
    ipcInitialized = false
  }
}
