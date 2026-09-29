import type { DownloadPhase, DownloadTask } from './types'

export type ProgressView = {
  phase: DownloadPhase
  phaseProgress: number | null
  overallProgress: number | null
  isIndeterminate: boolean
  percentLabel: string
}

const clamp = (value: number) => Math.max(0, Math.min(100, value))
const finitePercent = (value: number | null | undefined): number | null =>
  value != null && Number.isFinite(value) ? clamp(value) : null

/** Called by the manager before every broadcast or durable state transition. */
export function updateTaskProgress(task: DownloadTask): void {
  const post = task.hasPostProcessing ?? task.engine === 'ytdlp'
  task.hasPostProcessing = post
  const status = task.status
  const processing = status === 'merging' || status === 'converting'
  const trim = Boolean(task.startTime || task.endTime)
  const hasProgress = task.downloadedBytes > 0 || (task.downloadPercent ?? 0) > 0 || (task.speedBytesPerSec ?? 0) > 0
  const phase: DownloadPhase = status === 'downloading'
    ? (trim ? 'trimming' : hasProgress ? 'downloading' : 'starting')
    : status === 'converting' && trim ? 'trimming' : status

  let download = finitePercent(task.downloadPercent)
  if (download === null && task.totalBytes && task.totalBytes > 0) {
    download = clamp(task.downloadedBytes / task.totalBytes * 100)
  }
  const process = finitePercent(task.convertingPercent)
  const phaseProgress = status === 'completed' ? 100 : processing ? process : download
  let overall: number | null
  if (status === 'completed') overall = 100
  else if (processing) overall = process === null ? 90 : Math.min(99, 90 + process * 0.09)
  else if (download === null) overall = null
  else if (task.engine === 'ffmpeg') overall = Math.min(99, download)
  else if (post) overall = Math.min(90, download * 0.9)
  else overall = download

  if ((status === 'error' || status === 'canceled') && overall !== null) {
    overall = Math.min(99, overall)
  }

  // A new attempt may restart its bytes, but a live job never visually regresses.
  if (status === 'downloading' && task.overallProgress != null && overall != null) {
    overall = Math.max(task.overallProgress, overall)
  }
  task.phase = phase
  task.phaseProgress = phaseProgress
  task.overallProgress = overall
}

/** Both React's initial render and the fast DOM path consume this same projection. */
export function getProgressView(task: DownloadTask): ProgressView {
  const phase = task.phase ?? (task.status === 'downloading' && !task.downloadedBytes && !task.downloadPercent
    ? 'starting' : task.status)
  const overallProgress = task.status === 'completed' ? 100 : finitePercent(task.overallProgress)
  const phaseProgress = task.status === 'completed' ? 100 : finitePercent(task.phaseProgress)
  const processing = phase === 'merging' || phase === 'converting' || phase === 'trimming'
  const isIndeterminate = (processing && phaseProgress === null) ||
    (overallProgress === null && (phase === 'starting' || phase === 'downloading' || processing))
  return {
    phase,
    phaseProgress,
    overallProgress,
    isIndeterminate,
    percentLabel: isIndeterminate || overallProgress === null ? '' : `${Math.round(overallProgress)}%`,
  }
}
