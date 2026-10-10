import { app, dialog, ipcMain } from 'electron'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import type { SpeechModel, TranslationModel, SubtitleRequest, SubtitleCue } from '../../../Shared/localSubtitles'
import { SubtitleAssets } from './assets'
import { LocalSubtitleService } from './service'

let service: LocalSubtitleService | null = null
export function registerLocalSubtitleIpc(getWin: () => BrowserWindow | null): void {
  const get = () => service ??= new LocalSubtitleService(new SubtitleAssets(path.join(app.getPath('userData'), 'local-subtitles')))
  ipcMain.handle('cortexdl:subtitles:state', () => get().state)
  ipcMain.handle('cortexdl:subtitles:readiness', () => get().assets.readiness())
  ipcMain.handle('cortexdl:subtitles:install', (_event, speech: SpeechModel, translation: TranslationModel | null) => get().install(speech, translation))
  ipcMain.handle('cortexdl:subtitles:start', (_event, request: SubtitleRequest) => get().start(request))
  ipcMain.handle('cortexdl:subtitles:cancel', (_event, id: string) => get().cancel(id))
  ipcMain.handle('cortexdl:subtitles:select', async () => {
    const win = getWin(); if (!win || get().busy) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Video and audio', extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'ogv', 'mp3', 'wav', 'm4a', 'aac', 'opus', 'flac', 'ogg', 'wma'] }] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('cortexdl:subtitles:export', async (_event, id: string, cues: SubtitleCue[], format: 'srt' | 'vtt') => {
    const win = getWin(), document = get().state.document
    if (!win || !document || document.id !== id || get().busy) throw new Error('Subtitle document is not ready')
    if (!['srt', 'vtt'].includes(format)) throw new Error('Invalid subtitle format')
    const name = `${document.name.replace(/[<>:"/\\|?*]/g, '_')}.${document.targetLanguage}.${format}`
    const result = await dialog.showSaveDialog(win, { defaultPath: document.localFile ? path.join(path.dirname(document.localFile), name) : name, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
    if (result.canceled || !result.filePath) return null
    await get().exportDocument(id, cues, format, result.filePath)
    return result.filePath
  })
  ipcMain.handle('cortexdl:subtitles:embed', async (_event, id: string, cues: SubtitleCue[]) => {
    const win = getWin(), document = get().state.document
    if (!win || !document?.localFile || document.id !== id || get().busy) throw new Error('Subtitle video is not ready')
    const result = await dialog.showSaveDialog(win, { defaultPath: path.join(path.dirname(document.localFile), `${document.name}.subtitled.mkv`), filters: [{ name: 'Video with subtitles', extensions: ['mkv'] }] })
    if (result.canceled || !result.filePath) return null
    return get().embedDocument(id, cues, result.filePath)
  })
}
export async function stopLocalSubtitles(): Promise<void> { await service?.dispose() }
