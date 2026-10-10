import { ipcRenderer, contextBridge } from 'electron'
import type { AppHealthCheck, DownloadTask, AnalyzeResult, JsRuntimeStatus, StartInput } from './types'
import { UPDATE_CHANNEL } from './types'

function invokeRendererSafe<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    const rawMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : ''
    const cleanMessage = rawMessage
      .replace(/^Error invoking remote method ['"][^'"]+['"]:s*/i, '')
      .replace(/^Error:s*/i, '')
      .trim()

    throw new Error(cleanMessage || 'The request could not be completed.')
  })
}
contextBridge.exposeInMainWorld('cortexDl', {
  reportFirstUiRender(): void { ipcRenderer.send('cortexdl:first-ui-render') },
  smokeMode: process.argv.includes('--cortex-smoke'),
  analysisDebug: process.env.CORTEX_ANALYSIS_DEBUG === '1',
  selectFolder(): Promise<string | null> {
    return ipcRenderer.invoke('cortexdl:select-folder')
  },
  saveSecureData(key: string, value: string): Promise<boolean> {
    return ipcRenderer.invoke('cortexdl:secure-save', key, value).then(encryptedBase64 => {
      if (encryptedBase64) {
        localStorage.setItem(`secure_${key}`, encryptedBase64)
        return true
      }
      return false
    })
  },
  getSecureData(key: string): Promise<string> {
    const encryptedBase64 = localStorage.getItem(`secure_${key}`)
    if (!encryptedBase64) return Promise.resolve('')
    return ipcRenderer.invoke('cortexdl:secure-get', encryptedBase64)
  },
  downloadComments(url: string): Promise<boolean | { success: boolean; canceled?: boolean; error?: string }> {
    return ipcRenderer.invoke('cortexdl:download-comments', url)
  },
  onCommentsExtractionStarted(callback: () => void) {
    const fn = () => callback()
    ipcRenderer.on('cortexdl:comments-extraction-started', fn)
    return () => ipcRenderer.off('cortexdl:comments-extraction-started', fn)
  },
  onCommentsProgress(callback: (current: number, total: number) => void) {
    const fn = (_event: any, current: number, total: number) => callback(current, total)
    ipcRenderer.on('cortexdl:comments-progress', fn)
    return () => ipcRenderer.off('cortexdl:comments-progress', fn)
  },
  analyzeUrl(url: string, id?: string): Promise<AnalyzeResult> {
    return invokeRendererSafe('cortexdl:analyze-url', url, id)
  },
  refreshFormats(url: string, id: string): Promise<AnalyzeResult> {
    return invokeRendererSafe('cortexdl:analyze-url', url, id, 'formats')
  },
  refreshCaptions(url: string, id: string): Promise<import('../../Shared/types').CaptionDiscovery> {
    return invokeRendererSafe('cortexdl:analyze-url', url, id, 'captions')
  },
  cancelAnalysis(id: string): Promise<void> {
    return invokeRendererSafe('cortexdl:cancel-analysis', id)
  },
  onAnalysisUpdate(callback: (update: { id: string; stage: string; data: { title?: string; dislikes?: number } }) => void) {
    const listener = (_event: unknown, update: Parameters<typeof callback>[0]) => callback(update)
    ipcRenderer.on('cortexdl:analysis-update', listener)
    return () => ipcRenderer.off('cortexdl:analysis-update', listener)
  },
  listDownloads(): Promise<DownloadTask[]> {
    return ipcRenderer.invoke('cortexdl:downloads:list')
  },
  addDownload(input: StartInput): Promise<DownloadTask> {
    return ipcRenderer.invoke('cortexdl:downloads:add', input)
  },
  addBatchDownloads(inputs: StartInput[]): Promise<DownloadTask[]> {
    return ipcRenderer.invoke('cortexdl:downloads:add-batch', inputs)
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
  setConcurrency(value: number): Promise<void> {
    return ipcRenderer.invoke('cortexdl:set-concurrency', value)
  },
  getConcurrency(): Promise<number> {
    return ipcRenderer.invoke('cortexdl:get-concurrency')
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
  showMainWindow(): Promise<void> {
    return ipcRenderer.invoke('cortexdl:show-main-window')
  },
  updateEngine(): Promise<{ success: boolean; message: string }> {
    return ipcRenderer.invoke('cortexdl:update-engine')
  },
  getEngineVersion(): Promise<string> {
    return ipcRenderer.invoke('cortexdl:get-engine-version')
  },
  checkJsRuntime(): Promise<JsRuntimeStatus> {
    return ipcRenderer.invoke('cortexdl:check-js-runtime')
  },
  getSetupState() { return ipcRenderer.invoke('cortexdl:setup-state') },
  repairEngines() { return ipcRenderer.invoke('cortexdl:repair-engines') },
  openLogs() { return ipcRenderer.invoke('cortexdl:open-logs') },
  exitApp() { return ipcRenderer.invoke('cortexdl:exit') },
  exportDiagnostics() { return ipcRenderer.invoke('cortexdl:export-diagnostics') },
  getBuildInfo() { return ipcRenderer.invoke('cortexdl:build-info') },
  getHealthCheck(): Promise<AppHealthCheck> {
    return ipcRenderer.invoke('cortexdl:health-check')
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
  onSetupProgress(callback: (state: { status: string; progress: number; message: string }) => void): () => void {
    const listener = (_event: unknown, state: any) => callback(state)
    ipcRenderer.on('cortexdl:setup-progress', listener)
    return () => ipcRenderer.off('cortexdl:setup-progress', listener)
  },
  getMediaPort(): Promise<number> {
    return ipcRenderer.invoke('cortexdl:get-media-port')
  },
  getMediaEndpoint(): Promise<{ port: number; token: string }> {
    return ipcRenderer.invoke('cortexdl:get-media-endpoint')
  },
  closeMediaSession(session: string): Promise<void> {
    return ipcRenderer.invoke('cortexdl:close-media-session', session)
  },
  getMediaDiagnostics(): Promise<unknown> {
    return ipcRenderer.invoke('cortexdl:get-media-diagnostics')
  },
  onCloseMediaPlayer(callback: () => void): () => void {
    const listener = () => callback()
    ipcRenderer.on('cortexdl:close-media-player', listener)
    return () => ipcRenderer.off('cortexdl:close-media-player', listener)
  },
  fetchThumbnail(url: string): Promise<string> {
    return ipcRenderer.invoke('cortexdl:fetch-thumbnail', url)
  },
  getMediaFps(filePath: string, session: string): Promise<number | null> {
    return ipcRenderer.invoke('cortexdl:get-media-fps', filePath, session)
  },
  getDirectStreamUrl(url: string, previewSession?: string): Promise<string> {
    return invokeRendererSafe('cortexdl:get-direct-stream-url', url, previewSession)
  },
  getTrimPreviewStreams(url: string, previewSession: string): Promise<{ videoUrl: string; audioUrl?: string } | null> {
    return invokeRendererSafe('cortexdl:get-trim-preview-streams', url, previewSession)
  },
  logPreviewError(message: string): void {
    ipcRenderer.send('cortexdl:preview-error', message)
  },
  getSubtitles(filePath: string, session: string): Promise<import('../../Shared/types').PlayerSubtitleTrack[]> {
    return ipcRenderer.invoke('cortexdl:get-subtitles', filePath, session)
  },
  getLocalSubtitleState: () => invokeRendererSafe<import('../../Shared/localSubtitles').SubtitleState>('cortexdl:subtitles:state'),
  getLocalSubtitleReadiness: () => invokeRendererSafe<import('../../Shared/localSubtitles').SubtitleReadiness>('cortexdl:subtitles:readiness'),
  selectSubtitleMedia: () => invokeRendererSafe<string | null>('cortexdl:subtitles:select'),
  installSubtitleModels: (speech: import('../../Shared/localSubtitles').SpeechModel, translation: import('../../Shared/localSubtitles').TranslationModel | null) => invokeRendererSafe<string>('cortexdl:subtitles:install', speech, translation),
  startLocalSubtitles: (request: import('../../Shared/localSubtitles').SubtitleRequest) => invokeRendererSafe<string>('cortexdl:subtitles:start', request),
  cancelLocalSubtitles: (id: string) => invokeRendererSafe<void>('cortexdl:subtitles:cancel', id),
  exportLocalSubtitles: (id: string, cues: import('../../Shared/localSubtitles').SubtitleCue[], format: 'srt' | 'vtt') => invokeRendererSafe<string | null>('cortexdl:subtitles:export', id, cues, format),
  embedLocalSubtitles: (id: string, cues: import('../../Shared/localSubtitles').SubtitleCue[]) => invokeRendererSafe<string | null>('cortexdl:subtitles:embed', id, cues),
})
