import { ipcMain, type BrowserWindow } from 'electron'
import path from 'node:path'
import { validateSubtitleRequest } from '../../Shared/localSubtitles'

export function validateIpcArguments(channel: string, args: unknown[]): void {
  const first = args[0]
  if (channel.startsWith('cortexdl:library:')) {
    const operation = channel.slice('cortexdl:library:'.length)
    if (['list', 'select'].includes(operation)) {
      if (args.length) throw new Error('Invalid library operation')
    } else if (operation === 'check') {
      if (args.length !== 1 || !Array.isArray(first) || first.length > 32 || first.some(value => typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value))) throw new Error('Invalid library items')
    } else if (operation === 'add') {
      if (args.length !== 1 || !Array.isArray(first) || first.length > 10000 || first.some(value => typeof value !== 'string' || value.length > 32767 || value.includes('\0') || !path.isAbsolute(value))) throw new Error('Invalid library paths')
    } else if (['artwork-select', 'artwork-remove', 'artwork-embed'].includes(operation)) {
      if (args.length < 1 || args.length > 2 || typeof first !== 'string' || !/^[\w-]{1,128}$/.test(first) || args.length === 2 && typeof args[1] !== 'boolean') throw new Error('Invalid library item')
    } else if (!['remove', 'play', 'relocate', 'thumbnail', 'artwork-info'].includes(operation) || args.length !== 1 || typeof first !== 'string' || !/^[\w-]{1,128}$/.test(first)) throw new Error('Invalid library item')
  }
  if (channel.startsWith('cortexdl:subtitle-files:')) {
    if (typeof first !== 'string' || !/^[\w-]{1,128}$/.test(first)) throw new Error('Invalid download ID')
    if (channel.endsWith(':merge')) {
      if (args.length !== 3 || typeof args[1] !== 'string' || args[1].length > 255 || /[/\\\0]/.test(args[1]) || !/\.(srt|vtt)$/i.test(args[1]) || !['mp4', 'mkv'].includes(String(args[2]))) throw new Error('Invalid subtitle merge')
    } else if (args.length !== 1) throw new Error('Invalid subtitle operation')
  }
  if (channel === 'cortexdl:subtitles:start') validateSubtitleRequest(first)
  if (channel === 'cortexdl:subtitles:clear' && (typeof first !== 'string' || !/^[\w-]{0,128}$/.test(first) || args.length !== 1)) throw new Error('Invalid subtitle session ID')
  if (channel === 'cortexdl:subtitles:install' && (!['accurate', 'fast'].includes(String(first)) || args[1] !== null && !['standard', 'quality'].includes(String(args[1])) || args[2] !== undefined && !['auto', 'cpu'].includes(String(args[2])))) throw new Error('Invalid subtitle models')
  if (['cortexdl:subtitles:cancel', 'cortexdl:subtitles:export', 'cortexdl:subtitles:embed'].includes(channel) && (typeof first !== 'string' || !/^[\w-]{1,128}$/.test(first))) throw new Error('Invalid subtitle operation ID')
  if (channel === 'cortexdl:subtitles:embed' && (!Array.isArray(args[1]) || args[1].length > 50000)) throw new Error('Invalid subtitle embedding')
  if (channel === 'cortexdl:subtitles:export' && (!Array.isArray(args[1]) || args[1].length > 50000 || !['srt', 'vtt'].includes(String(args[2])))) throw new Error('Invalid subtitle export')
  if (channel === 'cortexdl:analyze-url' && args.length > 2) throw new Error('Invalid analysis arguments')
  const paths = ['open-folder', 'open-file', 'get-media-fps', 'get-subtitles']
  if (paths.some(name => channel === `cortexdl:${name}`)) {
    if (typeof first !== 'string' || first.length > 32767 || first.includes('\0') || !path.isAbsolute(first)) throw new Error('Invalid file path')
    if (channel.endsWith('open-file') && !/\.(?:mp4|mkv|webm|avi|mov|ogv|m4v|gif|mp3|m4a|aac|opus|flac|wav|ogg|wma|srt|vtt|txt)$/i.test(first)) throw new Error('Only media and text files can be opened')
  }
  if (channel === 'cortexdl:set-concurrency' && (!Number.isInteger(first) || Number(first) < 1 || Number(first) > 20)) throw new Error('Invalid concurrency')
  if (/^cortexdl:downloads:(pause|resume|cancel|delete)$/.test(channel) && (typeof first !== 'string' || !/^[\w-]{1,128}$/.test(first))) throw new Error('Invalid task ID')
  if (channel === 'cortexdl:downloads:delete' && typeof args[1] !== 'boolean') throw new Error('Invalid delete flag')
  if (['cortexdl:secure-save', 'cortexdl:secure-get'].includes(channel) && args.some(arg => typeof arg !== 'string' || arg.length > 65536)) throw new Error('Invalid secure data')
  if (['cortexdl:analyze-url', 'cortexdl:open-external', 'cortexdl:get-direct-stream-url', 'cortexdl:get-trim-preview-streams', 'cortexdl:download-comments', 'cortexdl:fetch-thumbnail'].includes(channel)) {
    if (typeof first !== 'string' || first.length > 16384) throw new Error('Invalid URL')
    const url = new URL(first)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL must be HTTP or HTTPS')
  }
}
/** All invoke handlers, including startup/recovery handlers, share sender and schema checks. */
export function installIpcBoundary(getWin: () => BrowserWindow | null): void {
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
    const win = getWin()
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unauthorized IPC sender')
    validateIpcArguments(channel, args)
    return listener(event, ...args)
  })
  const on = ipcMain.on.bind(ipcMain)
  ipcMain.on = (channel, listener) => on(channel, (...args: any[]) => {
    if (channel.startsWith('cortexdl:') || channel === 'log-message') {
      const event = args[0]
      const win = getWin()
      if (!win || event?.sender !== win.webContents || event?.senderFrame !== win.webContents.mainFrame) return
    }
    listener(args[0], ...args.slice(1))
  })
}
