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
  /**
   * Timestamp (ms) before which this task must not be picked up by
   * `DownloadManager.schedule()`. Set by `scheduleRetry()` while a
   * task-level retry backoff is pending, so the backoff never occupies an
   * active concurrency slot (see EngineContext.scheduleRetry).
   */
  retryAt?: number
}

export interface EngineContext {
  
  sendUpdate: (task: DownloadTask) => void
  

  runtime: TaskRuntime
  
  saveState: () => void
  
  flushSave: () => void
  /**
   * Requests that the DownloadManager re-attempt this task after `delayMs`,
   * without occupying an active download slot for the duration of the
   * backoff. Engines must set `task.status = 'queued'` and return from
   * `download()` immediately after calling this — never sleep inline.
   */
  scheduleRetry: (delayMs: number) => void
  sendStats: (id: string, addedBytes: number) => void
  sendYouTubeOAuthCode: (payload: YouTubeOAuthCodePayload) => void
}

