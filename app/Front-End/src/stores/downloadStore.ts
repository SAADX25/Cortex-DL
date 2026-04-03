/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Download Store — Single source of truth for all download tasks.
 *
 *  Architecture: Zustand Map store with per-task rendering via selectors.
 *
 *  IPC wiring is done via `initDownloadStore()` which starts the single
 *  app-wide high-frequency IPC listeners (DOM-fast-path + throttled store).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { create } from 'zustand'
import type { DownloadTask } from '../../../Shared/types'
import { startHighFrequencyIPCListeners } from '../hooks/useHighFrequencyIPC'

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

  const { upsertTask } = useDownloadStore.getState()

  // Single source of truth for volatile updates.
  // `useHighFrequencyIPC.ts` owns all onDownloadUpdated/onDownloadProgress listeners.
  const disposeIPC = startHighFrequencyIPCListeners({
    upsertTask,
    getTaskById: (id) => useDownloadStore.getState().tasks.get(id),
  })

  // Load initial task list (Shared DownloadTask shape; no legacy normalization).
  window.cortexDl.listDownloads().then((initial) => {
    for (const t of initial as DownloadTask[]) upsertTask(t)
  })

  return () => {
    disposeIPC()
    ipcInitialized = false
  }
}

