/**
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
    // Clean up all merge simulation timers
    for (const id of mergeSimState.keys()) stopMergeSimulation(id)
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
      stopMergeSimulation(taskId)
    }
  }, [taskId, progressBarRef, speedTextRef, percentTextRef, vmRef, onStructuralChange])
}

// ── Merge Simulation ─────────────────────────────────────────────────────────
// When yt-dlp merges audio+video, it spawns FFmpeg internally but doesn't
// output FFmpeg's time= progress. So task.convertingPercent stays at 0 and the
// bar looks "stuck". This simulation animates the bar from 90% → 99% using a
// logarithmic ease-out curve so the user sees continuous progress.

const mergeSimState = new Map<string, { timer: ReturnType<typeof setInterval>; startMs: number }>()

function startMergeSimulation(taskId: string): void {
  stopMergeSimulation(taskId)

  const startMs = Date.now()
  const timer = setInterval(() => {
    const refs = domRegistry.get(taskId)
    if (!refs) { stopMergeSimulation(taskId); return }

    const elapsedSec = (Date.now() - startMs) / 1000
    // Logarithmic ease-out: fast start, approaches 99% asymptotically
    // ~92% at 2s, ~94% at 4s, ~96% at 8s, ~97% at 12s, ~98% at 20s
    const simPercent = Math.min(99, Math.round(90 + 9 * (1 - Math.exp(-elapsedSec / 8))))

    if (refs.progressBarRef?.current) {
      const bar = refs.progressBarRef.current
      bar.style.width = `${simPercent}%`
      // Ensure correct classes even if React re-renders with indeterminate
      bar.classList.remove('indeterminate', 'downloading')
      if (!bar.classList.contains('merging') && !bar.classList.contains('converting')) {
        bar.classList.add('merging')
      }
    }
    if (refs.percentTextRef?.current) {
      refs.percentTextRef.current.innerText = `${simPercent}%`
    }
  }, 200) // Update every 200ms for smooth animation

  mergeSimState.set(taskId, { timer, startMs })
}

function stopMergeSimulation(taskId: string): void {
  const sim = mergeSimState.get(taskId)
  if (sim) {
    clearInterval(sim.timer)
    mergeSimState.delete(taskId)
  }
}

// ── Direct DOM mutation for high-frequency progress updates ──────────────────

/** Phase CSS classes used on the bar fill element */
const PHASE_CLASSES = ['downloading', 'merging', 'converting', 'completed', 'error', 'paused', 'queued']

function updateDomForTask(task: DownloadTask): void {
  const refs = domRegistry.get(task.id)
  if (!refs) return

  // ── Weighted progress engine (mirrors useDownloadCardVM logic) ──────────
  // Download phase → 0–90%, Merge/Convert phase → 90–100%
  const DOWNLOAD_WEIGHT = 0.90
  const POST_WEIGHT = 0.10

  const isPostProcessing = task.status === 'merging' || task.status === 'converting'
  const dlPct = task.downloadPercent != null && !isNaN(task.downloadPercent) && task.downloadPercent > 0
    ? task.downloadPercent : null
  const convPct = task.convertingPercent != null && !isNaN(task.convertingPercent) && task.convertingPercent > 0
    ? task.convertingPercent : null

  // ── Proactive merge detection ───────────────────────────────────────────
  // When downloadPercent hits 100% but status is still 'downloading',
  // the download bytes are done and yt-dlp is about to merge audio+video.
  // Start the purple simulation immediately so the user doesn't see a
  // "stuck" blue bar at 90%. If download resets (e.g., audio stream starts
  // after video stream), dlPct drops and the simulation auto-stops.
  const downloadDone = task.status === 'downloading' && dlPct !== null && dlPct >= 100
  const shouldSimulateMerge = (isPostProcessing && convPct === null) || downloadDone

  if (shouldSimulateMerge) {
    // Start simulated progress animation (90% → 99%)
    if (!mergeSimState.has(task.id)) {
      startMergeSimulation(task.id)
    }
    // Swap bar to purple merge style
    if (refs.progressBarRef?.current) {
      const bar = refs.progressBarRef.current
      bar.classList.remove('indeterminate', 'downloading')
      if (!bar.classList.contains('merging') && !bar.classList.contains('converting')) {
        bar.classList.add(isPostProcessing ? task.status : 'merging')
      }
    }
    return // Simulation timer handles DOM updates from here
  } else {
    // Stop simulation when download resets or task left post-processing
    stopMergeSimulation(task.id)
  }

  // ── Calculate weighted percent ─────────────────────────────────────────
  let percent: number
  let percentText: string

  if (task.status === 'completed') {
    percent = 100
    percentText = '100%'
  } else if (isPostProcessing && convPct !== null) {
    // Real FFmpeg progress available
    const basePercent = Math.round(DOWNLOAD_WEIGHT * 100)
    percent = Math.min(99, basePercent + Math.round(POST_WEIGHT * convPct))
    percentText = `${percent}%`
  } else if (dlPct !== null && dlPct > 0) {
    percent = Math.min(Math.round(DOWNLOAD_WEIGHT * 100), Math.round(DOWNLOAD_WEIGHT * dlPct))
    percentText = `${percent}%`
  } else if (task.totalBytes && task.totalBytes > 0 && task.downloadedBytes > 0) {
    const rawPct = Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100))
    percent = Math.min(Math.round(DOWNLOAD_WEIGHT * 100), Math.round(DOWNLOAD_WEIGHT * rawPct))
    percentText = `${percent}%`
  } else {
    percent = 0
    percentText = ''
  }

  // ── Update progress bar width + phase CSS class ────────────────────────
  if (refs.progressBarRef?.current) {
    const bar = refs.progressBarRef.current
    bar.style.width = `${percent}%`

    // Swap phase CSS class on the bar fill for color transitions
    const targetClass = isPostProcessing ? task.status
      : (task.status === 'downloading' ? 'downloading'
      : (task.status === 'completed' ? 'completed'
      : (task.status === 'paused' ? 'paused'
      : (task.status === 'error' ? 'error'
      : (task.status === 'queued' ? 'queued' : '')))))
    for (const cls of PHASE_CLASSES) {
      if (cls === targetClass) {
        if (!bar.classList.contains(cls)) bar.classList.add(cls)
      } else {
        bar.classList.remove(cls)
      }
    }

    // Remove indeterminate when we have real progress during post-processing
    if (isPostProcessing && convPct !== null) {
      bar.classList.remove('indeterminate')
    }
  }

  // ── Update percent text ────────────────────────────────────────────────
  if (refs.percentTextRef?.current) {
    refs.percentTextRef.current.innerText = percentText
  }

  // ── Update speed text ──────────────────────────────────────────────────
  if (refs.speedTextRef?.current && task.speedBytesPerSec !== null) {
    refs.speedTextRef.current.innerText = formatSpeedForDisplay(task.speedBytesPerSec)
  }
}

// ── Structural change detection ──────────────────────────────────────────────

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
