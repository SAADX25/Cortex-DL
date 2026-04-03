/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Shared Types — Single source of truth for the entire download system.
 *
 *  Every module in the electron/ directory imports types from HERE.
 *  No duplicated type definitions anywhere else in the backend.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type {
  DownloadTask,
  DownloadStatus,
  DownloadEngine,
  VideoFormat,
  AudioFormat,
  TargetFormat,
} from '../../Shared/types'

export type { DownloadTask, DownloadStatus, DownloadEngine, VideoFormat, AudioFormat, TargetFormat }
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

// ── Analysis Types ───────────────────────────────────────────────────────────

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
}

export type AnalyzeResult =
  | { kind: 'unknown' }
  | { kind: 'direct' }
  | { kind: 'hls-media'; url: string }
  | { kind: 'hls-master'; variants: HlsVariant[] }
  | { 
      kind: 'ytdlp'; 
      title: string; 
      thumbnail?: string; 
      formats: YtdlpFormat[];
      views?: number;
      likes?: number;
      comments?: { author: string; text: string; likeCount: number }[];
    }
  | { kind: 'playlist'; title: string; items: { id: string; title: string; url: string; thumbnail?: string }[] }
