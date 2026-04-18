/**
 *  Download Store — Single source of truth for all download tasks.
 *
 *  Architecture: Zustand Map store with per-task rendering via selectors.
 *
 *  IPC wiring is done via `initDownloadStore()` which starts the single
 *  app-wide high-frequency IPC listeners (DOM-fast-path + throttled store).
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

  /** Batch-insert multiple new tasks in a single atomic state update */
  addMultipleTasks: (tasks: DownloadTask[]) => void

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

  addMultipleTasks: (tasks) =>
    set((state) => {
      const next = new Map(state.tasks)
      const newIds: string[] = []
      for (const t of tasks) {
        if (!next.has(t.id)) newIds.push(t.id)
        next.set(t.id, t)
      }
      return {
        tasks: next,
        taskIds: newIds.length > 0 ? [...newIds.reverse(), ...state.taskIds] : state.taskIds,
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

/** Select a single task by ID */
export const useTask = (id: string) =>
  useDownloadStore((s) => s.tasks.get(id))

/** Select ordered task IDs */
export const useTaskIds = () =>
  useDownloadStore((s) => s.taskIds)

/** Get the full tasks map snapshot */
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
