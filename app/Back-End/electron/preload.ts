import { ipcRenderer, contextBridge } from 'electron'
import type { DownloadTask, AnalyzeResult, StartInput } from './types'
import { UPDATE_CHANNEL } from './types'

contextBridge.exposeInMainWorld('cortexDl', {
  selectFolder(): Promise<string | null> {
    return ipcRenderer.invoke('cortexdl:select-folder')
  },
  selectCookiesFile(): Promise<string | null> {
    return ipcRenderer.invoke('cortexdl:select-cookies-file')
  },
  downloadComments(url: string): Promise<boolean | { success: boolean; canceled?: boolean; error?: string }> {
    return ipcRenderer.invoke('cortexdl:download-comments', url)
  },
  onCommentsExtractionStarted(callback: () => void) {
    const fn = () => callback()
    ipcRenderer.on('cortexdl:comments-extraction-started', fn)
    return () => ipcRenderer.off('cortexdl:comments-extraction-started', fn)
  },
  analyzeUrl(url: string, browser?: string): Promise<AnalyzeResult> {
    return ipcRenderer.invoke('cortexdl:analyze-url', url, browser)
  },
  listDownloads(): Promise<DownloadTask[]> {
    return ipcRenderer.invoke('cortexdl:downloads:list')
  },
  addDownload(input: StartInput): Promise<DownloadTask> {
    return ipcRenderer.invoke('cortexdl:downloads:add', input)
  },
  pauseDownload(id: string): Promise<DownloadTask> {
    return ipcRenderer.invoke('cortexdl:downloads:pause', id)
  },
  resumeDownload(id: string): Promise<DownloadTask> {
    return ipcRenderer.invoke('cortexdl:downloads:resume', id)
  },
  cancelDownload(id: string): Promise<DownloadTask> {
    return ipcRenderer.invoke('cortexdl:downloads:cancel', id)
  },
  deleteDownload(id: string, deleteFile: boolean): Promise<void> {
    return ipcRenderer.invoke('cortexdl:downloads:delete', id, deleteFile)
  },
  clearCompleted(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:downloads:clear-completed')
  },
  pauseAll(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:downloads:pause-all')
  },
  resumeAll(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:downloads:resume-all')
  },
  openFolder(filePath: string): Promise<void> {
    return ipcRenderer.invoke('cortexdl:open-folder', filePath)
  },
  openFile(filePath: string): Promise<void> {
    return ipcRenderer.invoke('cortexdl:open-file', filePath)
  },
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke('cortexdl:open-external', url)
  },
  checkEngines(): Promise<{ ytdlp: boolean; ffmpeg: boolean; jsRuntime: boolean; jsRuntimeName: string }> {
    return ipcRenderer.invoke('cortexdl:check-engines')
  },
  updateEngine(): Promise<{ success: boolean; message: string }> {
    return ipcRenderer.invoke('cortexdl:update-engine')
  },
  getEngineVersion(): Promise<string> {
    return ipcRenderer.invoke('cortexdl:get-engine-version')
  },
  checkForUpdates(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:check-for-updates')
  },
  restartApp(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:restart-app')
  },
  uninstallApp(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:uninstall-app')
  },
  onUpdateStatus(callback: (status: any) => void): () => void {
    const listener = (_event: unknown, status: any) => callback(status)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.off('update-status', listener)
  },
  onDownloadUpdated(callback: (task: DownloadTask) => void): () => void {
    const listener = (_event: unknown, task: DownloadTask) => callback(task)
    ipcRenderer.on(UPDATE_CHANNEL, listener)
    return () => ipcRenderer.off(UPDATE_CHANNEL, listener)
  },
  onDownloadProgress(callback: (data: any) => void): () => void {
    const listener = (_event: unknown, data: any) => callback(data)
    ipcRenderer.on('cortexdl:download-progress', listener)
    return () => ipcRenderer.off('cortexdl:download-progress', listener)
  },
  onStatsUpdated(callback: (data: { id: string; addedBytes: number }) => void): () => void {
    const listener = (_event: unknown, data: { id: string; addedBytes: number }) => callback(data)
    ipcRenderer.on('cortexdl:download-stats-updated', listener)
    return () => ipcRenderer.off('cortexdl:download-stats-updated', listener)
  },
  fetchThumbnail(url: string): Promise<string> {
    return ipcRenderer.invoke('cortexdl:fetch-thumbnail', url)
  },
})
