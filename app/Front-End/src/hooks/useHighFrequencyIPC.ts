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

export function startHighFrequencyIPCListeners(opts: {
  upsertTask: (task: DownloadTask) => void
  getTaskById: (id: string) => DownloadTask | undefined
}): () => void {
  
  if (ipcListenersStarted) return () => {}

  ipcListenersStarted = true

  const disposeUpdated = window.cortexDl.onDownloadUpdated((task: DownloadTask) => {
    if (!task?.id) return

    
    updateDomForTask(task)

    
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

const mergeSimState = new Map<string, { timer: ReturnType<typeof setInterval>; startMs: number }>()

function startMergeSimulation(taskId: string): void {
  stopMergeSimulation(taskId)

  const startMs = Date.now()
  const timer = setInterval(() => {
    const refs = domRegistry.get(taskId)
    if (!refs) { stopMergeSimulation(taskId); return }

    const elapsedSec = (Date.now() - startMs) / 1000
    
    
    const simPercent = Math.min(99, Math.round(90 + 9 * (1 - Math.exp(-elapsedSec / 8))))

    if (refs.progressBarRef?.current) {
      const bar = refs.progressBarRef.current
      bar.style.width = `${simPercent}%`
      
      bar.classList.remove('indeterminate', 'downloading')
      if (!bar.classList.contains('merging') && !bar.classList.contains('converting')) {
        bar.classList.add('merging')
      }
    }
    if (refs.percentTextRef?.current) {
      refs.percentTextRef.current.innerText = `${simPercent}%`
    }
  }, 200) 

  mergeSimState.set(taskId, { timer, startMs })
}

function stopMergeSimulation(taskId: string): void {
  const sim = mergeSimState.get(taskId)
  if (sim) {
    clearInterval(sim.timer)
    mergeSimState.delete(taskId)
  }
}

const PHASE_CLASSES = ['downloading', 'merging', 'converting', 'completed', 'error', 'paused', 'queued']

function updateDomForTask(task: DownloadTask): void {
  const refs = domRegistry.get(task.id)
  if (!refs) return

  
  
  const DOWNLOAD_WEIGHT = 0.90
  const POST_WEIGHT = 0.10

  const isTrimmedTask = Boolean(task.startTime || task.endTime)
  const isTrimDownload = isTrimmedTask && task.status === 'downloading'
  const isTrimMode = isTrimDownload || (isTrimmedTask && task.status === 'converting')
  const isPostProcessing = task.status === 'merging' || task.status === 'converting' || isTrimDownload
  const dlPct = task.downloadPercent != null && !isNaN(task.downloadPercent) && task.downloadPercent > 0
    ? task.downloadPercent : null
  const convPct = task.convertingPercent != null && !isNaN(task.convertingPercent) && task.convertingPercent > 0
    ? task.convertingPercent : null
  const trimPct = isTrimMode ? (convPct ?? dlPct) : null

  
  
  
  
  
  
  const downloadDone = !isTrimMode && task.status === 'downloading' && dlPct !== null && dlPct >= 100
  const shouldSimulateMerge = !isTrimMode && ((isPostProcessing && convPct === null) || downloadDone)

  if (shouldSimulateMerge) {
    
    if (!mergeSimState.has(task.id)) {
      startMergeSimulation(task.id)
    }
    
    if (refs.progressBarRef?.current) {
      const bar = refs.progressBarRef.current
      bar.classList.remove('indeterminate', 'downloading')
      if (!bar.classList.contains('merging') && !bar.classList.contains('converting')) {
        bar.classList.add(isPostProcessing ? task.status : 'merging')
      }
    }
    return 
  } else {
    
    stopMergeSimulation(task.id)
  }

  
  let percent: number
  let percentText: string

  if (task.status === 'completed') {
    percent = 100
    percentText = '100%'
  } else if (isTrimMode && trimPct !== null) {
    percent = trimPct
    percentText = `${trimPct}%`
  } else if (isPostProcessing && convPct !== null) {
    
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

  
  if (refs.progressBarRef?.current) {
    const bar = refs.progressBarRef.current
    bar.style.width = `${percent}%`

    
    const targetClass = isTrimMode ? 'converting'
      : isPostProcessing ? task.status
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

    
    if (percent > 0 || task.status === 'completed') {
      bar.classList.remove('indeterminate')
    }
  }

  
  if (refs.percentTextRef?.current) {
    refs.percentTextRef.current.innerText = percentText
  }

  
  if (refs.speedTextRef?.current && task.speedBytesPerSec !== null) {
    refs.speedTextRef.current.innerText = formatSpeedForDisplay(task.speedBytesPerSec)
  }
}

function structuralKey(task: DownloadTask): string {
  const speedPositive = task.speedBytesPerSec != null && task.speedBytesPerSec > 0
  const totalKnown = task.totalBytes != null && task.totalBytes > 0
  const percentKnown = (task.downloadPercent != null && task.downloadPercent > 0)
    || (task.convertingPercent != null && task.convertingPercent > 0)
  const trimActive = Boolean(task.startTime || task.endTime) && task.status === 'downloading' && percentKnown
  return `${task.status}|${task.errorMessage ?? ''}|speed=${speedPositive}|total=${totalKnown}|percent=${percentKnown}|trim=${trimActive}`
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
