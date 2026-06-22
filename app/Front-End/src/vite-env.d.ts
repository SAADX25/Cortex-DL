/// <reference types="vite/client" />

import type {
  DownloadStatus as SharedDownloadStatus,
  VideoFormat as SharedVideoFormat,
  AudioFormat as SharedAudioFormat,
  TargetFormat as SharedTargetFormat,
  DownloadTask as SharedDownloadTask,
  SubtitleTrack as SharedSubtitleTrack,
  ThumbnailDataUrl as SharedThumbnailDataUrl,
  AppHealthCheck as SharedAppHealthCheck,
  CookieValidationResult as SharedCookieValidationResult,
  JsRuntimeStatus as SharedJsRuntimeStatus,
} from '../../Shared/types'

declare global {
  const __APP_VERSION__: string

  type DownloadStatus = SharedDownloadStatus
  type DownloadTask = SharedDownloadTask

  type VideoFormat = SharedVideoFormat
  type AudioFormat = SharedAudioFormat
  type TargetFormat = SharedTargetFormat
  type ThumbnailDataUrl = SharedThumbnailDataUrl
  type AppHealthCheck = SharedAppHealthCheck
  type CookieValidationResult = SharedCookieValidationResult
  type JsRuntimeStatus = SharedJsRuntimeStatus

  type HlsVariant = {
    bandwidth: number | null
    resolution: { width: number; height: number } | null
    url: string
  }

  type YtdlpFormat = {
    formatId: string
    ext: string
    resolution: string
    filesize: number | null
    description: string
    url?: string
    height?: number
    fps?: number
  }

  type AnalyzeResult =
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
      subtitles?: SharedSubtitleTrack[]
      comments?: { author: string; text: string; likeCount: number }[]
    }
    | { kind: 'playlist'; title: string; items: { id: string; title: string; url: string; thumbnail?: string }[] }

  interface DownloadProgressData {
    id?: string
    Id?: string
    [key: string]: unknown
  }

  interface UpdateStatusData {
    status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
    percent?: number
    error?: string
  }

  type DownloadCommentsResult =
    | boolean
    | { success: boolean; canceled?: boolean; error?: string; filePath?: string }

  interface Window {
    cortexDl: {

      saveSecureData(key: string, value: string): Promise<boolean>
      getSecureData(key: string): Promise<string>

      selectFolder: () => Promise<string | null>

      downloadComments: (url: string) => Promise<DownloadCommentsResult>
      onCommentsExtractionStarted: (callback: () => void) => () => void
      onCommentsProgress: (callback: (current: number, total: number) => void) => () => void

      analyzeUrl: (url: string) => Promise<AnalyzeResult>

      listDownloads: () => Promise<DownloadTask[]>
      addDownload: (input: {
        url: string
        directory: string
        subfolderName?: string
        filename?: string
        engine?: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp'
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
      }) => Promise<DownloadTask>
      addBatchDownloads: (inputs: {
        url: string
        directory: string
        subfolderName?: string
        filename?: string
        engine?: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp'
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
      }[]) => Promise<DownloadTask[]>
      pauseDownload: (id: string) => Promise<DownloadTask>
      resumeDownload: (id: string) => Promise<DownloadTask>
      cancelDownload: (id: string) => Promise<DownloadTask>
      deleteDownload: (id: string, deleteFile: boolean) => Promise<void>
      clearCompleted: () => Promise<void>
      pauseAll: () => Promise<void>
      resumeAll: () => Promise<void>
      setConcurrency: (value: number) => Promise<void>
      getConcurrency: () => Promise<number>

      openFolder: (filePath: string) => Promise<void>
      openFile: (filePath: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      showMainWindow: () => Promise<void>

      updateEngine: () => Promise<{ success: boolean; message: string; version?: string }>
      getEngineVersion: () => Promise<string>
      checkJsRuntime: () => Promise<JsRuntimeStatus>
      getHealthCheck: () => Promise<AppHealthCheck>

      checkForUpdates: () => Promise<void>
      restartApp: () => Promise<void>
      uninstallApp: () => Promise<void>

      getMediaPort: () => Promise<number>
      fetchThumbnail: (url: string) => Promise<string>
      getMediaFps: (filePath: string) => Promise<number | null>
      getDirectStreamUrl: (url: string) => Promise<string>

      selectCookieFile: () => Promise<string | null>
      getCookieFile: () => Promise<string | null>
      setCookieFile: (filePath: string | null) => Promise<CookieValidationResult>
      getSubtitles: (filePath: string) => Promise<import('../../Shared/types').PlayerSubtitleTrack[]>

      onUpdateStatus: (callback: (status: UpdateStatusData) => void) => () => void
      onDownloadUpdated: (callback: (task: DownloadTask) => void) => () => void
      onDownloadProgress: (callback: (data: DownloadProgressData) => void) => () => void
      onStatsUpdated: (callback: (data: { id: string; addedBytes: number }) => void) => () => void
    }
  }
}

export { }
