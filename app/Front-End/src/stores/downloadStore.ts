import { useShallow } from 'zustand/react/shallow'
import { create } from 'zustand'
import { type DownloadTask } from '../../../Shared/types'
import { startHighFrequencyIPCListeners } from '../hooks/useHighFrequencyIPC'

interface DownloadStoreState {
  tasks: Map<string, DownloadTask>

  taskIds: string[]

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

export const useTask = (id: string) =>
  useDownloadStore((s) => s.tasks.get(id))

export const useTaskIds = () =>
  useDownloadStore((s) => s.taskIds)

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
  let disposed = false
  let pendingRefresh: Promise<void> | null = null

  const disposeIPC = startHighFrequencyIPCListeners({
    upsertTask,
  })

  const refreshHistory = (): Promise<void> => {
    if (pendingRefresh) return pendingRefresh
    pendingRefresh = window.cortexDl.listDownloads().then((initial) => {
      if (!disposed) for (const t of initial as DownloadTask[]) upsertTask(t)
    }).catch(error => {
      if (!disposed) console.error('[Downloads] Failed to load history:', error)
    }).finally(() => { pendingRefresh = null })
    return pendingRefresh
  }
  const disposeSetup = window.cortexDl.onSetupProgress(state => {
    if (state.status === 'ready') {
      void (pendingRefresh ?? Promise.resolve()).then(() => {
        if (!disposed) return refreshHistory()
      })
    }
  })
  void refreshHistory()

  return () => {
    disposed = true
    disposeSetup()
    disposeIPC()
    ipcInitialized = false
  }
}

export const useDownloadSnapshot = () => useDownloadStore(useShallow(state => ({
  tasks: state.tasks, ids: state.taskIds, version: state.version,
})))
