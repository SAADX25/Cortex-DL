import { useMemo, useCallback } from 'react'
import { useTask } from '../stores/downloadStore'
import type { Language } from '../translations'
import { translations } from '../translations'
import { getProgressView } from '../../../Shared/progressModel'
import type { DownloadPhase } from '../../../Shared/types'
import { youtubeErrorMessage } from '../lib/downloadHelpers'

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const precision = unit === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0
  return `${value.toFixed(precision)} ${units[unit]}`
}

function formatSpeed(bytesPerSec: number | null, lang: Language): string {
  if (bytesPerSec == null || bytesPerSec <= 0) return '-'
  return `${formatBytes(bytesPerSec)}/${translations[lang].speed_unit}`
}

function formatEta(remainingBytes: number, speedBps: number): string {
  if (speedBps <= 0 || remainingBytes <= 0) return '--:--'
  const secs = Math.ceil(remainingBytes / speedBps)
  if (secs > 86400) return '>1d'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export type DisplayPhase = DownloadPhase

export interface DownloadCardVM {
  
  id: string
  title: string
  thumbnail: string | null
  formatTag: string

  
  phase: DisplayPhase
  phaseLabel: string
  phaseColor: string

  
  percent: number          
  percentLabel: string     
  isIndeterminate: boolean 
  sizeLabel: string        
  speedLabel: string       
  etaLabel: string         

  
  errorMessage: string | null

  
  showPause: boolean
  showResume: boolean
  showCancel: boolean
  showPlay: boolean
  showOpenFolder: boolean

  
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onPlay: () => void
  onOpenFolder: () => void
  onDelete: (deleteFile: boolean) => void

  
  filePath: string
}

interface UseDownloadCardVMOptions {
  id: string
  lang: Language
  onOpenFile: (filePath: string, title?: string) => void
  onOpenFolder: (filePath: string) => void
  onDelete: (id: string, deleteFile: boolean) => void
  onError: (msg: string) => void
}

export function useDownloadCardVM(opts: UseDownloadCardVMOptions): DownloadCardVM | null {
  const { id, lang, onOpenFile, onOpenFolder, onDelete, onError } = opts
  const task = useTask(id)
  const t = translations[lang]

  

  const vm = useMemo<DownloadCardVM | null>(() => {
    if (!task) return null

    
    
    
    
    const progress = getProgressView(task)
    const phase = progress.phase

    const phaseLabels: Record<DisplayPhase, string> = {
      queued: t.status_queued,
      starting: t.accelerating,
      preparing: t.accelerating,
      pausing: t.status_paused,
      validating: lang === 'ar' ? 'التحقق من الملف' : 'Validating',
      finalizing: lang === 'ar' ? 'إنهاء التنزيل' : 'Finalizing',
      downloading: t.status_downloading,
      merging: t.status_merging,
      converting: t.status_converting,
      trimming: t.trimming,
      paused: t.status_paused,
      completed: t.status_completed,
      error: t.status_error,
      canceled: t.status_canceled,
    }

    
    const phaseColors: Record<DisplayPhase, string> = {
      queued: 'var(--text-muted)',
      starting: 'var(--accent-primary)',
      preparing: 'var(--accent-primary)',
      pausing: 'var(--warning)',
      validating: '#a78bfa',
      finalizing: '#a78bfa',
      downloading: '#3b82f6',
      merging: '#a78bfa',
      converting: '#a78bfa',
      trimming: '#a78bfa',
      paused: 'var(--warning)',
      completed: '#22c55e',
      error: 'var(--error)',
      canceled: 'var(--text-muted)',
    }

    
    
    
    
    
    
    
    
    
    const isPostProcessing = phase === 'merging' || phase === 'converting' || phase === 'trimming'
    const convPct = isPostProcessing ? progress.phaseProgress : null
    const percent = progress.overallProgress ?? 0
    const percentLabel = progress.percentLabel
    const isIndeterminate = progress.isIndeterminate

    const knownTotal = task.totalBytes != null && task.totalBytes > 0
    const remaining = task.etaSeconds ?? 0
    const isDownloading = phase === 'downloading'
    const isActivePhase = isDownloading || isPostProcessing
    let sizeLabel = ''
    if (task.status === 'completed' && task.outputBytes != null) sizeLabel = formatBytes(task.outputBytes)
    else if (isActivePhase || task.status === 'completed') {
      if (knownTotal) {
        sizeLabel = `${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes!)}`
      } else if (task.downloadedBytes > 0) {
        
        sizeLabel = formatBytes(task.downloadedBytes)
      }
    }

    const speedLabel = isDownloading
      ? formatSpeed(task.speedBytesPerSec, lang)
      : ''

    const etaLabel = isDownloading && knownTotal
      ? formatEta(remaining, 1)
      : ''

    
    
    const phaseEmoji = phase === 'merging' ? '⚙️' : phase === 'trimming' ? '✂️' : phase === 'converting' ? '🔄' : ''
    const phaseBadge = isPostProcessing
      ? `${phaseEmoji} ${convPct !== null ? `${phaseLabels[phase]} ${Math.round(convPct)}%` : phaseLabels[phase]}`
      : ''
    const finalPhaseLabel = isPostProcessing ? phaseBadge : phaseLabels[phase]

    
    const showPause = task.status === 'downloading' || task.status === 'queued' || task.status === 'merging' || task.status === 'converting'
    const showResume = task.status === 'paused' || task.status === 'error'
    const showCancel = task.status !== 'completed' && task.status !== 'canceled'
    const showPlay = task.status === 'completed'
    const showOpenFolder = task.status === 'completed'

    return {
      id: task.id,
      title: task.title || task.filename,
      thumbnail: task.thumbnail ?? null,
      formatTag: task.targetFormat,
      phase,
      phaseLabel: finalPhaseLabel,
      phaseColor: phaseColors[phase],
      percent,
      percentLabel,
      isIndeterminate,
      sizeLabel,
      speedLabel,
      etaLabel,
      errorMessage: youtubeErrorMessage(task.errorMessage, t) ?? task.errorMessage ?? null,
      showPause,
      showResume,
      showCancel,
      showPlay,
      showOpenFolder,
      filePath: task.filePath,
      
      onPause: () => {},
      onResume: () => {},
      onCancel: () => {},
      onPlay: () => {},
      onOpenFolder: () => {},
      onDelete: () => {},
    }
  }, [task, lang, t])

  

  const handlePause = useCallback(async () => {
    try { await window.cortexDl.pauseDownload(id) }
    catch (err) { onError(err instanceof Error ? err.message : t.pause_failed) }
  }, [id, onError, t.pause_failed])

  const handleResume = useCallback(async () => {
    try { await window.cortexDl.resumeDownload(id) }
    catch (err) { onError(err instanceof Error ? err.message : t.resume_failed) }
  }, [id, onError, t.resume_failed])

  const handleCancel = useCallback(async () => {
    try { await window.cortexDl.cancelDownload(id) }
    catch (err) { onError(err instanceof Error ? err.message : t.cancel_failed) }
  }, [id, onError, t.cancel_failed])

  const handlePlay = useCallback(() => {
    if (task) onOpenFile(task.filePath, task.title || task.filename)
  }, [task, onOpenFile])

  const handleOpenFolder = useCallback(() => {
    if (task) onOpenFolder(task.filePath)
  }, [task, onOpenFolder])

  const handleDelete = useCallback(
    (deleteFile: boolean) => onDelete(id, deleteFile),
    [id, onDelete],
  )

  
  if (!vm) return null

  return {
    ...vm,
    onPause: handlePause,
    onResume: handleResume,
    onCancel: handleCancel,
    onPlay: handlePlay,
    onOpenFolder: handleOpenFolder,
    onDelete: handleDelete,
  }
}
