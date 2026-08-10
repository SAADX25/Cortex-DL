import { create } from 'zustand'
import type { DownloadTask } from '../../../Shared/types'
import { startHighFrequencyIPCListeners } from '../hooks/useHighFrequencyIPC'

interface DownloadStoreState {
  
  tasks: Map<string, DownloadTask>

  
  taskIds: string[]

  /**
   * Bumped on every mutation — including in-place updates to an *existing*
   * task's fields (title, thumbnail, status, ...). `taskIds` only changes
   * reference when tasks are actually added/removed, so anything that needs
   * to react to a task's *content* changing (e.g. DownloadList's search
   * filter, which re-reads `task.title`/`task.url` from the map) must depend
   * on `version` instead of `taskIds`, otherwise it silently keeps filtering
   * against a stale snapshot (see `useTasksVersion` below).
   */
  version: number

  
  upsertTask: (task: DownloadTask) => void

  
  removeTask: (id: string) => void

  
  addMultipleTasks: (tasks: DownloadTask[]) => void

  
  loadTasks: (tasks: DownloadTask[]) => void

  
  clearCompleted: () => void
}

export const useDownloadStore = create<DownloadStoreState>((set) => ({
  tasks: new Map(),
  taskIds: [],
  version: 0,

  upsertTask: (task) =>
    set((state) => {
      const isNew = !state.tasks.has(task.id)

      // ── Priority 5: avoid the O(n) Map clone on every progress tick ──
      // This used to be `new Map(state.tasks)`, which allocates and copies
      // *every* task in the app on every single call. With several active
      // downloads all reporting progress (throttled to ~4/sec each, see
      // useHighFrequencyIPC), that's effectively O(n²) allocation churn per
      // second for no benefit — the per-task selector (`useTask(id)` below)
      // only needs `tasks.get(id)` to return a *new task object* for `id`,
      // it never compares the Map's own identity. Mutating the Map in place
      // is safe: nothing in the app subscribes to the raw `tasks` reference
      // to detect changes anymore — broad consumers (Sidebar's badge count,
      // etc.) use the derived/primitive selectors below, and `version` gives
      // anyone else a cheap, explicit "something changed" signal.
      state.tasks.set(task.id, task)

      return {
        tasks: state.tasks,
        taskIds: isNew ? [task.id, ...state.taskIds] : state.taskIds,
        version: state.version + 1,
      }
    }),

  removeTask: (id) =>
    set((state) => {
      state.tasks.delete(id)
      return {
        tasks: state.tasks,
        taskIds: state.taskIds.filter((tid) => tid !== id),
        version: state.version + 1,
      }
    }),

  addMultipleTasks: (tasks) =>
    set((state) => {
      const newIds: string[] = []
      for (const t of tasks) {
        if (!state.tasks.has(t.id)) newIds.push(t.id)
        state.tasks.set(t.id, t)
      }
      return {
        tasks: state.tasks,
        taskIds: newIds.length > 0 ? [...newIds.reverse(), ...state.taskIds] : state.taskIds,
        version: state.version + 1,
      }
    }),

  loadTasks: (tasks) =>
    set((state) => {
      state.tasks.clear()
      const ids: string[] = []
      for (const t of tasks) {
        state.tasks.set(t.id, t)
        ids.push(t.id)
      }
      return { tasks: state.tasks, taskIds: ids, version: state.version + 1 }
    }),

  clearCompleted: () =>
    set((state) => {
      const nextIds: string[] = []
      for (const id of state.taskIds) {
        const t = state.tasks.get(id)
        if (t && t.status !== 'completed' && t.status !== 'canceled') {
          nextIds.push(id)
        } else {
          state.tasks.delete(id)
        }
      }
      return { tasks: state.tasks, taskIds: nextIds, version: state.version + 1 }
    }),
}))

/** Narrow, per-task subscription — only re-renders when *this* task's object reference changes. */
export const useTask = (id: string) =>
  useDownloadStore((s) => s.tasks.get(id))

export const useTaskIds = () =>
  useDownloadStore((s) => s.taskIds)

/**
 * Store-versioned selector for consumers that read task *content* (not just
 * ids) outside of React's normal render dependency tracking — e.g.
 * DownloadList's search filter, which looks up `task.title`/`task.url` via
 * `getTasksSnapshot()`. Depending on `taskIds` alone is not enough because
 * `taskIds` is stable across in-place task updates.
 */
export const useTasksVersion = () =>
  useDownloadStore((s) => s.version)

function countActive(state: DownloadStoreState): number {
  let count = 0
  for (const id of state.taskIds) {
    const t = state.tasks.get(id)
    if (t && (t.status === 'downloading' || t.status === 'queued' || t.status === 'converting')) count++
  }
  return count
}

/**
 * Derived, primitive selector for leaf components that only need a count
 * (e.g. Sidebar's nav badge, the "remaining batch slots" calculation).
 * Subscribing to this instead of the raw `tasks` Map means the component
 * only re-renders when the *number* actually changes, and never allocates
 * an intermediate array (unlike the previous `Array.from(...).filter(...)`).
 */
export const useActiveDownloadCount = () => useDownloadStore(countActive)

export const useTotalDownloadCount = () => useDownloadStore((s) => s.taskIds.length)

export const getActiveDownloadCount = () => countActive(useDownloadStore.getState())

export const getTasksSnapshot = () =>
  useDownloadStore.getState().tasks

let ipcInitialized = false

export function initDownloadStore(): () => void {
  if (ipcInitialized) return () => {}
  ipcInitialized = true

  const { upsertTask } = useDownloadStore.getState()

  
  
  const disposeIPC = startHighFrequencyIPCListeners({
    upsertTask,
    getTaskById: (id) => useDownloadStore.getState().tasks.get(id),
  })

  
  window.cortexDl.listDownloads().then((initial) => {
    for (const t of initial as DownloadTask[]) upsertTask(t)
  })

  return () => {
    disposeIPC()
    ipcInitialized = false
  }
}
