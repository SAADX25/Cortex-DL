/// <reference types="vite/client" />

import type {
  DownloadStatus as SharedDownloadStatus,
  VideoFormat as SharedVideoFormat,
  AudioFormat as SharedAudioFormat,
  TargetFormat as SharedTargetFormat,
  DownloadTask as SharedDownloadTask,
  ThumbnailDataUrl as SharedThumbnailDataUrl,
  AppHealthCheck as SharedAppHealthCheck,
  JsRuntimeStatus as SharedJsRuntimeStatus,
} from '../../Shared/types'

declare global {
  const __APP_VERSION__: string
  const __BUILD_SHA__: string

  type DownloadStatus = SharedDownloadStatus
  type DownloadTask = SharedDownloadTask

  type VideoFormat = SharedVideoFormat
  type AudioFormat = SharedAudioFormat
  type TargetFormat = SharedTargetFormat
  type ThumbnailDataUrl = SharedThumbnailDataUrl
  type AppHealthCheck = SharedAppHealthCheck
  type JsRuntimeStatus = SharedJsRuntimeStatus

  type HlsVariant = {
    bandwidth: number | null
    resolution: { width: number; height: number } | null
    url: string
  }

  type YtdlpFormat = {
    formatId: string
    vcodec?: string
    acodec?: string
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
      preview?: boolean
      title: string
      thumbnail?: string
      formats: YtdlpFormat[]
      views?: number
      likes?: number
      dislikes?: number
      duration?: number
      qualityStatus?: 'restricted' | 'limited' | 'available'
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
    __cortexMediaDiagnostics?: () => Promise<unknown>
    cortexDl: {
      readonly customTitleBar: boolean
      getDroppedMediaPaths: (files: File[]) => string[]
      listMediaLibrary: () => Promise<import('../../Shared/mediaLibrary').LibraryMediaItem[]>
      checkMediaLibraryFiles: (ids: string[]) => Promise<import('../../Shared/mediaLibrary').LibraryMediaItem[]>
      getMediaLibraryThumbnail: (id: string) => Promise<string | null>
      getMediaLibraryArtworkInfo: (id: string) => Promise<import('../../Shared/mediaLibrary').LibraryArtworkInfo>
      selectMediaLibraryArtwork: (id: string, refreshPlayer?: boolean) => Promise<import('../../Shared/mediaLibrary').LibraryMediaItem[] | null>
      removeMediaLibraryArtwork: (id: string, refreshPlayer?: boolean) => Promise<import('../../Shared/mediaLibrary').LibraryMediaItem[]>
      embedMediaLibraryArtwork: (id: string, refreshPlayer?: boolean) => Promise<import('../../Shared/mediaLibrary').LibraryMediaItem[]>
      selectMediaLibraryFiles: () => Promise<import('../../Shared/mediaLibrary').LibraryImportResult | null>
      addMediaLibraryFiles: (files: string[]) => Promise<import('../../Shared/mediaLibrary').LibraryImportResult>
      removeMediaLibraryItem: (id: string) => Promise<import('../../Shared/mediaLibrary').LibraryMediaItem[]>
      playMediaLibraryItem: (id: string) => Promise<import('../../Shared/mediaLibrary').LibraryMediaItem>
      relocateMediaLibraryItem: (id: string) => Promise<import('../../Shared/mediaLibrary').LibraryMediaItem[] | null>
      reportFirstUiRender(): void
      analysisDebug: boolean

      saveSecureData(key: string, value: string): Promise<boolean>
      getSecureData(key: string): Promise<string>

      selectFolder: () => Promise<string | null>

      downloadComments: (url: string) => Promise<DownloadCommentsResult>
      onCommentsExtractionStarted: (callback: () => void) => () => void
      onCommentsProgress: (callback: (current: number, total: number) => void) => () => void

      cancelAnalysis: (id: string) => Promise<void>
      onAnalysisUpdate: (callback: (update: { id: string; stage: string; data: { title?: string; dislikes?: number } }) => void) => () => void
      analyzeUrl: (url: string, id?: string) => Promise<AnalyzeResult>

      listDownloads: () => Promise<DownloadTask[]>
      addDownload: (input: {
        url: string
        directory: string
        subfolderName?: string
        filename?: string
        engine?: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp'
        targetFormat?: TargetFormat
        ytdlpFormatId?: string
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
      getSetupState: () => Promise<{ status: string; progress: number; message: string }>
      repairEngines: () => Promise<unknown>
      openLogs: () => Promise<void>
      exitApp: () => Promise<void>
      exportDiagnostics: () => Promise<boolean>
      getBuildInfo: () => Promise<{ version: string; commit: string; safeMode: boolean }>
      getHealthCheck: () => Promise<AppHealthCheck>

      checkForUpdates: () => Promise<void>
      restartApp: () => Promise<void>
      uninstallApp: () => Promise<void>

      getMediaPort: () => Promise<number>
      getMediaEndpoint: () => Promise<{ port: number; token: string }>
      closeMediaSession: (session: string) => Promise<void>
      getMediaDiagnostics: () => Promise<unknown>
      onCloseMediaPlayer: (callback: () => void) => () => void
      fetchThumbnail: (url: string) => Promise<string>
      getMediaFps: (filePath: string, session: string) => Promise<number | null>
      getDirectStreamUrl: (url: string, previewSession?: string) => Promise<string>
      getTrimPreviewStreams: (url: string, previewSession: string) => Promise<{ videoUrl: string; audioUrl?: string } | null>
      logPreviewError: (message: string) => void

      getSubtitles: (filePath: string, session: string) => Promise<import('../../Shared/types').PlayerSubtitleTrack[]>
      listDownloadSubtitleFiles: (id: string) => Promise<import('../../Shared/downloadSubtitles').DownloadSubtitleFile[]>
      mergeDownloadSubtitle: (id: string, fileName: string, format: import('../../Shared/downloadSubtitles').SubtitleMergeFormat) => Promise<string | null>
      cancelDownloadSubtitleMerge: (id: string) => Promise<void>
      getLocalSubtitleState: () => Promise<import('../../Shared/localSubtitles').SubtitleState>
      getLocalSubtitleReadiness: () => Promise<import('../../Shared/localSubtitles').SubtitleReadiness>
      selectSubtitleMedia: () => Promise<string | null>
      installSubtitleModels: (speech: import('../../Shared/localSubtitles').SpeechModel, translation: import('../../Shared/localSubtitles').TranslationModel | null, compute?: 'auto' | 'cpu') => Promise<string>
      startLocalSubtitles: (request: import('../../Shared/localSubtitles').SubtitleRequest) => Promise<string>
      cancelLocalSubtitles: (id: string) => Promise<void>
      clearLocalSubtitles: (id: string) => Promise<import('../../Shared/localSubtitles').SubtitleState>
      exportLocalSubtitles: (id: string, cues: import('../../Shared/localSubtitles').SubtitleCue[], format: 'srt' | 'vtt') => Promise<string | null>
      embedLocalSubtitles: (id: string, cues: import('../../Shared/localSubtitles').SubtitleCue[]) => Promise<string | null>

      onUpdateStatus: (callback: (status: UpdateStatusData) => void) => () => void
      onDownloadUpdated: (callback: (task: DownloadTask) => void) => () => void
      onDownloadProgress: (callback: (data: DownloadProgressData) => void) => () => void
      onStatsUpdated: (callback: (data: { id: string; addedBytes: number }) => void) => () => void
      onSetupProgress: (callback: (state: { status: string; progress: number; message: string }) => void) => () => void
    }
  }
}

export { }
