import { useEffect, useRef, type RefObject } from 'react'
import type { DownloadTask } from '../../../Shared/types'
import { getProgressView } from '../../../Shared/progressModel'
import type { DownloadCardVM } from './useDownloadCardVM'

interface RegisteredDom {
  progressBarRef?: RefObject<HTMLDivElement | null>
  speedTextRef?: RefObject<HTMLSpanElement | null>
  percentTextRef?: RefObject<HTMLSpanElement | null>
  vmRef?: RefObject<DownloadCardVM | null>
}

const domRegistry = new Map<string, RegisteredDom>()
const lastZustandSentAtMs = new Map<string, number>()
const lastStructuralKeyById = new Map<string, string>()
const lastTaskById = new Map<string, DownloadTask>()
let ipcListenersStarted = false
const ZUSTAND_THROTTLE_MS = 250
const TERMINAL = new Set(['completed', 'error', 'canceled', 'paused'])

export function startHighFrequencyIPCListeners(opts: {
  upsertTask: (task: DownloadTask) => void
  getTaskById: (id: string) => DownloadTask | undefined
}): () => void {
  if (ipcListenersStarted) return () => {}
  ipcListenersStarted = true
  const receive = (task: DownloadTask) => {
    if (!task?.id) return
    lastTaskById.set(task.id, task)
    updateDomForTask(task)
    maybeUpsertToZustand(task, opts)
  }
  const disposeUpdated = window.cortexDl.onDownloadUpdated(receive)
  const disposeProgress = window.cortexDl.onDownloadProgress((data: DownloadProgressData) => {
    const id = data?.id ?? data?.Id
    if (!id) return
    const task = lastTaskById.get(id) ?? opts.getTaskById(id)
    if (task) receive(task)
  })
  return () => {
    disposeUpdated()
    disposeProgress()
    ipcListenersStarted = false
    lastZustandSentAtMs.clear()
    lastStructuralKeyById.clear()
    lastTaskById.clear()
  }
}

export function useHighFrequencyIPC(taskId: string | undefined, options: RegisteredDom): void {
  const optionsRef = useRef(options)
  optionsRef.current = options
  useEffect(() => {
    if (!taskId) return
    // The registry object stays stable across structural React renders.
    const refs: RegisteredDom = {
      get progressBarRef() { return optionsRef.current.progressBarRef },
      get speedTextRef() { return optionsRef.current.speedTextRef },
      get percentTextRef() { return optionsRef.current.percentTextRef },
      get vmRef() { return optionsRef.current.vmRef },
    }
    domRegistry.set(taskId, refs)
    return () => { domRegistry.delete(taskId) }
  }, [taskId])
}

const PHASE_CLASSES = ['downloading', 'merging', 'converting', 'completed', 'error', 'paused', 'queued']
function updateDomForTask(task: DownloadTask): void {
  const refs = domRegistry.get(task.id)
  if (!refs) return
  const progress = getProgressView(task)
  const bar = refs.progressBarRef?.current
  if (bar) {
    bar.style.width = `${progress.isIndeterminate ? 100 : progress.overallProgress ?? 0}%`
    bar.classList.toggle('indeterminate', progress.isIndeterminate)
    const target = progress.phase === 'trimming' ? 'converting'
      : progress.phase === 'starting' ? 'downloading' : progress.phase
    for (const cls of PHASE_CLASSES) bar.classList.toggle(cls, cls === target)
  }
  if (refs.percentTextRef?.current) refs.percentTextRef.current.innerText = progress.percentLabel
  if (refs.speedTextRef?.current) refs.speedTextRef.current.innerText = formatSpeed(task.speedBytesPerSec)
}

function structuralKey(task: DownloadTask): string {
  const progress = getProgressView(task)
  return `${progress.phase}|${task.errorMessage ?? ''}|speed=${(task.speedBytesPerSec ?? 0) > 0}|total=${(task.totalBytes ?? 0) > 0}|known=${progress.overallProgress !== null}`
}

function maybeUpsertToZustand(task: DownloadTask, opts: { upsertTask: (task: DownloadTask) => void }): void {
  const now = Date.now()
  const key = structuralKey(task)
  const previous = lastStructuralKeyById.get(task.id)
  const last = lastZustandSentAtMs.get(task.id) ?? 0
  if (!TERMINAL.has(task.status) && key === previous && last !== 0 && now - last < ZUSTAND_THROTTLE_MS) return
  lastStructuralKeyById.set(task.id, key)
  lastZustandSentAtMs.set(task.id, now)
  opts.upsertTask({ ...task })
}

function formatSpeed(bytesPerSec: number | null): string {
  if (bytesPerSec == null || bytesPerSec <= 0) return '-'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytesPerSec
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  const digits = i === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0
  return `${value.toFixed(digits)} ${units[i]}`
}
