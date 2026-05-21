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
export type ThumbnailDataUrl = string

export type TrimSelection = {
  startSeconds: number
  endSeconds: number
  startTime: string
  endTime: string
}

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
  fps?: number | string
}

export type HlsVariant = {
  bandwidth: number | null
  resolution: { width: number; height: number } | null
  url: string
}

export type YtdlpFormat = {
  formatId: string
  ext: string
  resolution: string
  filesize: number | null
  description: string
  url?: string
  fps?: number
  height?: number
  tbr?: number
}

export type AnalyzeResult =
  | { kind: 'unknown' }
  | { kind: 'direct' }
  | { kind: 'hls-media'; url: string }
  | { kind: 'hls-master'; variants: HlsVariant[] }
  | {
      kind: 'ytdlp'
      title: string
      thumbnail?: string
      formats: YtdlpFormat[]
      views?: number
      likes?: number
      dislikes?: number
      duration?: number
      comments?: { author: string; text: string; likeCount: number }[]
    }
  | { kind: 'playlist'; title: string; items: { id: string; title: string; url: string; thumbnail?: string }[] }
