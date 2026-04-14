/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  useHighFrequencyIPC — Zero-Copy DOM Mutation on IPC Progress Events
 *
 *  Listens to high-frequency progress events and DIRECTLY mutates DOM elements
 *  via refs, bypassing React's reconciliation layer. This prevents re-renders
 *  and keeps the UI at 60 FPS even with 20+ concurrent downloads.
 *
 *  Usage:
 *    const progressBarRef = useRef<HTMLDivElement>(null)
 *    const speedTextRef = useRef<HTMLSpanElement>(null)
 *    const vmRef = useRef<DownloadCardVM | null>(null)
 *    
 *    useHighFrequencyIPC(taskId, {
 *      progressBarRef,
 *      speedTextRef,
 *      vmRef,
 *      onStructuralChange?: (newVM) => { // trigger React re-render }
 *    })
 *
 *  The hook directly updates:
 *    - progressBarRef.current.style.width = "XX%"
 *    - speedTextRef.current.innerText = "5.2 MB/s"
 *
 *  Only triggers React state changes (re-renders) for structural changes like:
 *    - Status transitions (downloading → completed)
 *    - Phase badge changes
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useEffect, RefObject } from 'react'
import type { DownloadTask } from '../../../Shared/types'
import type { DownloadCardVM } from './useDownloadCardVM'

interface UseHighFrequencyIPCOptions {
  progressBarRef?: RefObject<HTMLDivElement | null>
  speedTextRef?: RefObject<HTMLSpanElement | null>
  percentTextRef?: RefObject<HTMLSpanElement | null>
  vmRef?: RefObject<DownloadCardVM | null>
  onStructuralChange?: (newVM: DownloadCardVM) => void
}

/**
 * Start the single, app-wide IPC listeners that:
 * - mutate DOM refs instantly (if a task is registered)
 * - throttle Zustand store updates to reduce React renders
 */
export function startHighFrequencyIPCListeners(opts: {
  upsertTask: (task: DownloadTask) => void
  getTaskById: (id: string) => DownloadTask | undefined
}): () => void {
  // Ensures we never register multiple IPC listeners.
  if (ipcListenersStarted) return () => {}

  ipcListenersStarted = true

  const disposeUpdated = window.cortexDl.onDownloadUpdated((task: DownloadTask) => {
    if (!task?.id) return

    // DOM always gets updated immediately for smooth progress bars.
    updateDomForTask(task)

    // Zustand gets throttled updates for performance.
    maybeUpsertToZustand(task, opts)
  })

  const disposeProgress = window.cortexDl.onDownloadProgress((data: DownloadProgressData) => {
    const id: string | undefined = data?.id ?? data?.Id
    if (!id) return

    const existing = opts.getTaskById(id)
    if (!existing) return

    updateDomForTask(existing)
    maybeUpsertToZustand(existing, opts)
  })

  return () => {
    disposeUpdated()
    disposeProgress()
    ipcListenersStarted = false
    lastZustandSentAtMs.clear()
    lastStructuralKeyById.clear()
  }
}

interface RegisteredDom {
  progressBarRef?: RefObject<HTMLDivElement | null>
  speedTextRef?: RefObject<HTMLSpanElement | null>
  percentTextRef?: RefObject<HTMLSpanElement | null>
  vmRef?: RefObject<DownloadCardVM | null>
  onStructuralChange?: (newVM: DownloadCardVM) => void
}

const domRegistry = new Map<string, RegisteredDom>()

let ipcListenersStarted = false

// Store updates are throttled per task, but structural changes are always sent.
const ZUSTAND_THROTTLE_MS = 500
const lastZustandSentAtMs = new Map<string, number>()
const lastStructuralKeyById = new Map<string, string>()

export function useHighFrequencyIPC(
  taskId: string | undefined,
  options: UseHighFrequencyIPCOptions
): void {
  const {
    progressBarRef,
    speedTextRef,
    percentTextRef,
    vmRef,
    onStructuralChange,
  } = options

  useEffect(() => {
    if (!taskId) return

    domRegistry.set(taskId, {
      progressBarRef,
      speedTextRef,
      percentTextRef,
      vmRef,
      onStructuralChange,
    })

    return () => {
      domRegistry.delete(taskId)
    }
  }, [taskId, progressBarRef, speedTextRef, percentTextRef, vmRef, onStructuralChange])
}

function updateDomForTask(task: DownloadTask): void {
  const refs = domRegistry.get(task.id)
  if (!refs) return

  const percent = task.downloadedBytes && task.totalBytes
    ? Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100))
    : 0

  if (refs.progressBarRef?.current) {
    refs.progressBarRef.current.style.width = `${percent}%`
  }

  if (refs.percentTextRef?.current) {
    refs.percentTextRef.current.innerText = `${percent}%`
  }

  if (refs.speedTextRef?.current && task.speedBytesPerSec !== null) {
    refs.speedTextRef.current.innerText = formatSpeedForDisplay(task.speedBytesPerSec)
  }
}

function structuralKey(task: DownloadTask): string {
  const speedPositive = task.speedBytesPerSec != null && task.speedBytesPerSec > 0
  const totalKnown = task.totalBytes != null && task.totalBytes > 0
  return `${task.status}|${task.errorMessage ?? ''}|speed=${speedPositive}|total=${totalKnown}`
}

function maybeUpsertToZustand(
  task: DownloadTask,
  opts: { upsertTask: (task: DownloadTask) => void },
): void {
  const now = Date.now()
  const id = task.id

  const key = structuralKey(task)
  const prevKey = lastStructuralKeyById.get(id)
  const structuralChanged = prevKey !== key

  const lastAt = lastZustandSentAtMs.get(id) ?? 0
  const throttleOk = now - lastAt >= ZUSTAND_THROTTLE_MS

  const shouldSend = structuralChanged || lastAt === 0 || throttleOk
  if (!shouldSend) return

  lastStructuralKeyById.set(id, key)
  lastZustandSentAtMs.set(id, now)

  // Notify card to re-render if it relies on structural changes.
  if (structuralChanged) {
    const refs = domRegistry.get(id)
    const currentVM = refs?.vmRef?.current
    if (currentVM && refs?.onStructuralChange) refs.onStructuralChange(currentVM)
  }

  opts.upsertTask({ ...task })
}

function formatSpeedForDisplay(bytesPerSec: number | null): string {
  if (bytesPerSec == null || bytesPerSec <= 0) return '-'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytesPerSec
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const decimals = i === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0
  return `${value.toFixed(decimals)} ${units[i]}`
}
