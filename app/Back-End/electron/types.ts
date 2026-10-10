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
  JsRuntimeStatus,
  AppHealthCheck,
}
export { UPDATE_CHANNEL, PROGRESS_CHANNEL, STATS_CHANNEL, VIDEO_FORMATS, AUDIO_FORMATS } from '../../Shared/types'

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
  /**
   * Timestamp (ms) before which this task must not be picked up by
   * `DownloadManager.schedule()`. Set by `scheduleRetry()` while a
   * task-level retry backoff is pending, so the backoff never occupies an
   * active concurrency slot (owned by DownloadManager).
   */
  retryAt?: number
}

export type EngineResult =
  | { kind: 'success'; candidate: string }
  | { kind: 'paused' | 'canceled' }
  | { kind: 'retryable-error'; message: string; delayMs: number }
  | { kind: 'fatal-error'; message: string }

export type AttemptRuntime = TaskRuntime & {
  attemptId: string
  directory: string
  done?: Promise<void>
  stopReason?: 'paused' | 'canceled'
}

export interface EngineContext {
  runtime: TaskRuntime
  sendUpdate: (task: DownloadTask) => void
  saveState: () => void
  flushSave: () => void
}
