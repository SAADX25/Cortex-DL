import { ipcMain, type BrowserWindow } from 'electron'
import path from 'node:path'

export function validateIpcArguments(channel: string, args: unknown[]): void {
  const first = args[0]
  if (channel === 'cortexdl:analyze-url' && args[2] !== undefined && !['formats', 'captions'].includes(String(args[2]))) throw new Error('Invalid analysis mode')
  const paths = ['open-folder', 'open-file', 'get-media-fps', 'get-subtitles', 'set-cookie-file']
  if (paths.some(name => channel === `cortexdl:${name}`) && !(channel.endsWith('set-cookie-file') && first === null)) {
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
