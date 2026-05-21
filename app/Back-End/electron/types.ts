/**
 *  Shared Types — Single source of truth for the entire download system.
 *
 *  Every module in the electron/ directory imports types from HERE.
 *  No duplicated type definitions anywhere else in the backend.
 */
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
  AnalyzeResult,
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
  AnalyzeResult,
}
export { UPDATE_CHANNEL, PROGRESS_CHANNEL, STATS_CHANNEL, VIDEO_FORMATS, AUDIO_FORMATS } from '../../Shared/types'

// ── Add-Download Input ───────────────────────────────────────────────────────

export type StartInput = {
  url: string
  directory: string
  subfolderName?: string
  filename?: string
  engine?: 'auto' | DownloadEngine
  targetFormat?: TargetFormat
  ytdlpFormatId?: string
  title?: string
  thumbnail?: string
  cookieBrowser?: string
  cookieFile?: string
  username?: string
  password?: string
  speedLimit?: string
  startTime?: string
  endTime?: string
  fps?: number | string
}

// ── Per-Task Runtime State ───────────────────────────────────────────────────

export type TaskRuntime = {
  abortController: AbortController | null
  child: ChildProcessWithoutNullStreams | null
  lastSpeedSampleAtMs: number | null
  lastSpeedSampleBytes: number | null
  lastIpcAtMs: number
  retries: number
}

// ── Engine Context (callbacks injected by the orchestrator) ──────────────────

export interface EngineContext {
  /** Throttled — safe to call on every chunk / progress tick. */
  sendUpdate: (task: DownloadTask) => void
  /**
   * Runtime state for the specific task id.
   * Engines that manage child processes (ffmpeg, yt-dlp wrappers, etc.)
   * use this to support pause/stop and progress throttling.
   */
  runtime: TaskRuntime
  /** Debounced — coalesced to max 1 write/sec.  Use flushSave() for immediate. */
  saveState: () => void
  /** Immediate, crash-safe write.  Call on lifecycle transitions only. */
  flushSave: () => void
  sendStats: (id: string, addedBytes: number) => void
}

