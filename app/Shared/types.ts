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

export type VideoFormat = 'mp4' | 'mkv' | 'avi' | 'mov' | 'webm' | 'ogv' | 'm4v' | 'gif'
export type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac' | 'aac' | 'opus' | 'wma'
export type TargetFormat = VideoFormat | AudioFormat

export const VIDEO_FORMATS: VideoFormat[] = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'ogv', 'm4v', 'gif']
export const AUDIO_FORMATS: AudioFormat[] = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus', 'wma']

export const UPDATE_CHANNEL = 'cortexdl:download-updated'
export const PROGRESS_CHANNEL = 'cortexdl:download-progress'
export const STATS_CHANNEL = 'cortexdl:download-stats-updated'

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

