import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type {
  DownloadTask,
  DownloadStatus,
  DownloadEngine,
  VideoFormat,
  AudioFormat,
  TargetFormat,
  ThumbnailDataUrl,
  HlsVariant,
  YtdlpFormat,
  SubtitleTrack,
  AnalyzeResult,
  YouTubeOAuthCodePayload,
  CookieValidationCode,
  CookieValidationResult,
  JsRuntimeStatus,
  AppHealthCheck,
} from '../../Shared/types'

export type {
  DownloadTask,
  DownloadStatus,
  DownloadEngine,
  VideoFormat,
  AudioFormat,
  TargetFormat,
  ThumbnailDataUrl,
  HlsVariant,
  YtdlpFormat,
  SubtitleTrack,
  AnalyzeResult,
  YouTubeOAuthCodePayload,
  CookieValidationCode,
  CookieValidationResult,
  JsRuntimeStatus,
  AppHealthCheck,
}
export { UPDATE_CHANNEL, PROGRESS_CHANNEL, STATS_CHANNEL, YOUTUBE_OAUTH_CHANNEL, VIDEO_FORMATS, AUDIO_FORMATS } from '../../Shared/types'

export type StartInput = {
  url: string
  directory: string
  subfolderName?: string
  filename?: string
  engine?: 'auto' | DownloadEngine
  targetFormat?: TargetFormat
  ytdlpFormatId?: string
  subtitleLanguage?: string
  subtitleIsAutomatic?: boolean
  title?: string
  thumbnail?: string
  username?: string
  password?: string
  speedLimit?: string
  startTime?: string
  endTime?: string
  fps?: number | string
}

export type TaskRuntime = {
  abortController: AbortController | null
  child: ChildProcessWithoutNullStreams | null
  lastSpeedSampleAtMs: number | null
  lastSpeedSampleBytes: number | null
  lastIpcAtMs: number
  retries: number
  ignoreCookies?: boolean
}

export interface EngineContext {
  
  sendUpdate: (task: DownloadTask) => void
  

  runtime: TaskRuntime
  
  saveState: () => void
  
  flushSave: () => void
  sendStats: (id: string, addedBytes: number) => void
  sendYouTubeOAuthCode: (payload: YouTubeOAuthCodePayload) => void
}

