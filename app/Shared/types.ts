/**
 * Shared download contract between Electron (main process) and the React renderer.
 * Keep this file as the canonical source for:
 * - `DownloadTask`
 * - IPC channel names
 */

// ── Status & Engine ──────────────────────────────────────────────────────────
export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'converting'
  | 'paused'
  | 'completed'
  | 'error'
  | 'canceled'

export type DownloadEngine = 'direct' | 'ffmpeg' | 'ytdlp'

// ── Format Types ─────────────────────────────────────────────────────────────
export type VideoFormat = 'mp4' | 'mkv' | 'avi' | 'mov' | 'webm' | 'gif'
export type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac'
export type TargetFormat = VideoFormat | AudioFormat

export const VIDEO_FORMATS: VideoFormat[] = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'gif']
export const AUDIO_FORMATS: AudioFormat[] = ['mp3', 'wav', 'm4a', 'ogg', 'flac']

// ── IPC Channels ─────────────────────────────────────────────────────────────
export const UPDATE_CHANNEL = 'cortexdl:download-updated'
export const PROGRESS_CHANNEL = 'cortexdl:download-progress'
export const STATS_CHANNEL = 'cortexdl:download-stats-updated'

// ── Download Task ────────────────────────────────────────────────────────────
export type DownloadTask = {
  id: string
  url: string
  directory: string
  filename: string
  filePath: string
  engine: DownloadEngine
  targetFormat: TargetFormat
  status: DownloadStatus
  totalBytes: number | null
  downloadedBytes: number
  speedBytesPerSec: number | null
  errorMessage: string | null
  createdAtMs: number
  updatedAtMs: number
  title?: string
  thumbnail?: string
  cookieBrowser?: string
  cookieFile?: string
  username?: string
  password?: string
  speedLimit?: string
  startTime?: string
  endTime?: string
  convertingPercent?: number
  downloadPercent?: number
  ytdlpFormatId?: string
}

