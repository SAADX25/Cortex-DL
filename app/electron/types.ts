/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Shared Types — Single source of truth for the entire download system.
 *
 *  Every module in the electron/ directory imports types from HERE.
 *  No duplicated type definitions anywhere else in the backend.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

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
  | { kind: 'ytdlp'; title: string; thumbnail?: string; formats: YtdlpFormat[] }
  | { kind: 'playlist'; title: string; items: { id: string; title: string; url: string; thumbnail?: string }[] }
