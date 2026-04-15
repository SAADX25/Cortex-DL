/// <reference types="vite/client" />

import type {
  DownloadStatus as SharedDownloadStatus,
  VideoFormat as SharedVideoFormat,
  AudioFormat as SharedAudioFormat,
  TargetFormat as SharedTargetFormat,
  DownloadTask as SharedDownloadTask,
} from '../../Shared/types'

declare global {
  const __APP_VERSION__: string

  type DownloadStatus = SharedDownloadStatus
  type DownloadTask = SharedDownloadTask

  // These are kept in global scope for convenience in other type annotations.
  type VideoFormat = SharedVideoFormat
  type AudioFormat = SharedAudioFormat
  type TargetFormat = SharedTargetFormat

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
    height?: number
    fps?: number
  }

  type AnalyzeResult =
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
        dislikes?: number;
        duration?: number;
        comments?: { author: string; text: string; likeCount: number }[];
      }
    | { kind: 'playlist'; title: string; items: { id: string; title: string; url: string; thumbnail?: string }[] }

  /** Shape emitted by the main process on download progress events. */
  interface DownloadProgressData {
    id?: string
    Id?: string
    [key: string]: unknown
  }

  /** Shape emitted by the main process on auto-update status events. */
  interface UpdateStatusData {
    status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
    percent?: number
    error?: string
  }

  /** Result shape returned by downloadComments IPC. */
  type DownloadCommentsResult =
    | boolean
    | { success: boolean; canceled?: boolean; error?: string; filePath?: string }

  interface Window {
    cortexDl: {
      // ── Secure storage ──
      saveSecureData(key: string, value: string): Promise<boolean>
      getSecureData(key: string): Promise<string>

      // ── File / folder dialogs ──
      selectFolder: () => Promise<string | null>
      selectCookiesFile: () => Promise<string | null>

      // ── Comments extraction ──
      downloadComments: (url: string) => Promise<DownloadCommentsResult>
      onCommentsExtractionStarted: (callback: () => void) => () => void
      onCommentsProgress: (callback: (current: number, total: number) => void) => () => void

      // ── URL analysis ──
      analyzeUrl: (url: string, browser?: string) => Promise<AnalyzeResult>

      // ── Download CRUD ──
      listDownloads: () => Promise<DownloadTask[]>
      addDownload: (input: { 
        url: string; 
        directory: string; 
        subfolderName?: string;
        filename?: string; 
        engine?: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp'; 
        targetFormat?: TargetFormat; 
        ytdlpFormatId?: string; 
        title?: string; 
        thumbnail?: string; 
        cookieBrowser?: string;
        cookieFile?: string;
        username?: string;
        password?: string;
        speedLimit?: string;
        startTime?: string;
        endTime?: string;
      }) => Promise<DownloadTask>
      pauseDownload: (id: string) => Promise<DownloadTask>
      resumeDownload: (id: string) => Promise<DownloadTask>
      cancelDownload: (id: string) => Promise<DownloadTask>
      deleteDownload: (id: string, deleteFile: boolean) => Promise<void>
      clearCompleted: () => Promise<void>
      pauseAll: () => Promise<void>
      resumeAll: () => Promise<void>

      // ── Shell / filesystem ──
      openFolder: (filePath: string) => Promise<void>
      openFile: (filePath: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      showMainWindow: () => Promise<void>

      // ── Engines ──
      checkEngines: () => Promise<{ ytdlp: boolean; ffmpeg: boolean; jsRuntime: boolean; jsRuntimeName: string }>
      updateEngine: () => Promise<{ success: boolean; message: string; version?: string }>
      getEngineVersion: () => Promise<string>

      // ── App lifecycle ──
      checkForUpdates: () => Promise<void>
      restartApp: () => Promise<void>
      uninstallApp: () => Promise<void>

      // ── Media server ──
      getMediaPort: () => Promise<number>
      fetchThumbnail: (url: string) => Promise<string>

      // ── IPC event listeners (return dispose functions) ──
      onUpdateStatus: (callback: (status: UpdateStatusData) => void) => () => void
      onDownloadUpdated: (callback: (task: DownloadTask) => void) => () => void
      onDownloadProgress: (callback: (data: DownloadProgressData) => void) => () => void
      onStatsUpdated: (callback: (data: { id: string; addedBytes: number }) => void) => () => void
    }
  }
}

export {}
