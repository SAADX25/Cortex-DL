import type { DownloadPhase, DownloadTask } from './types'
export type ProgressView = { phase: DownloadPhase; phaseProgress: number | null; overallProgress: number | null; isIndeterminate: boolean; percentLabel: string }
const finitePercent = (n: number | null | undefined) => n != null && Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null

/** One projection for SQLite, IPC, React and the fast DOM path. No fabricated phase weights. */
export function updateTaskProgress(task: DownloadTask): void {
  const active = ['downloading', 'merging', 'converting'].includes(task.status)
  let phase: DownloadPhase = active ? task.phase ?? task.status : task.status
  if (active && ['paused', 'queued', 'error', 'canceled', 'completed', 'pausing'].includes(phase)) phase = 'preparing'
  if (task.status === 'merging' && !['validating', 'finalizing'].includes(phase)) phase = 'merging'
  if (task.status === 'converting' && !['trimming', 'validating', 'finalizing'].includes(phase)) phase = 'converting'
  const processing = ['merging', 'converting', 'trimming', 'validating'].includes(phase)
  const download = finitePercent(task.downloadPercent ?? (task.totalBytes && task.totalBytes > 0 ? task.downloadedBytes / task.totalBytes * 100 : null))
  task.phase = phase
  task.phaseProgress = task.status === 'completed' ? 100 : ['finalizing', 'preparing'].includes(phase) ? null : processing ? finitePercent(task.convertingPercent) : download
  // Later phases have no meaningful total-work denominator. Show actual phase progress.
  task.overallProgress = task.status === 'completed' ? 100 : task.phaseProgress === null ? null : Math.min(99, task.phaseProgress)
  task.etaSeconds = phase === 'downloading' && task.totalBytes && task.speedBytesPerSec && task.speedBytesPerSec > 0
    ? Math.max(0, (task.totalBytes - task.downloadedBytes) / task.speedBytesPerSec) : null
}
export function getProgressView(task: DownloadTask): ProgressView {
  const phase = task.phase ?? task.status
  const overallProgress = task.status === 'completed' ? 100 : finitePercent(task.overallProgress)
  const phaseProgress = task.status === 'completed' ? 100 : finitePercent(task.phaseProgress)
  const isIndeterminate = ['starting', 'preparing', 'downloading', 'merging', 'converting', 'trimming', 'validating', 'finalizing', 'pausing'].includes(phase) && phaseProgress === null
  return { phase, overallProgress, phaseProgress, isIndeterminate, percentLabel: isIndeterminate || overallProgress === null ? '' : `${Math.round(overallProgress)}%` }
}
