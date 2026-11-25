// Main IPC handler registry orchestrating downloads, system/update/credentials, analysis, media, and library channels
import { app, dialog, ipcMain, shell, safeStorage } from 'electron'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import { spawn } from 'node:child_process'
import { type DownloadManager } from '../downloadManager'
import { AUDIO_FORMATS, VIDEO_FORMATS, type StartInput } from '../types'
import { updateYtdlp, getYtdlpVersion, checkJsRuntime } from '../engines/ytdlpService'
import { db } from '../db'
import { registerDownloadSubtitleIpc } from '../subtitles/downloadMergeIpc'
import { registerMediaLibraryIpc } from './mediaLibraryIpc'
import { registerAnalysisIpcHandlers } from './analysisHandlers'
import { registerMediaIpcHandlers } from './mediaHandlers'
import { getAppHealthCheck } from './healthCheck'
import { type AppUpdateController } from '../services/updateService'

export interface IpcDependencies {
  getWin: () => Electron.BrowserWindow | null
  getDownloads: () => DownloadManager | null
  getUpdateService: () => AppUpdateController
  getMediaPort: () => number
  getMediaToken: () => string
  closeMediaSession: (session: string) => Promise<void>
  getMediaRequestStats: () => {
    streams: number
    ffmpegProcesses: number
    probeProcesses: number
    sessions: number
  }
  trackMediaProcess: (session: string, kind: 'ffmpeg' | 'probe', stop: () => void) => () => void
  isMediaSessionClosed: (session: string) => boolean
  serviceReadyPromise: Promise<void>
  uiReadyPromise?: Promise<unknown>
  mediaReadyPromise?: Promise<unknown>
}

const ALLOWED_TARGET_FORMATS = new Set<string>([...VIDEO_FORMATS, ...AUDIO_FORMATS])
const ALLOWED_ENGINES = new Set(['auto', 'direct', 'ffmpeg', 'ytdlp'])
const ALLOWED_TRIM_MODES = new Set(['fast', 'exact'])
const ALLOWED_OPEN_FILE_EXT =
  /\.(?:mp4|mkv|webm|avi|mov|ogv|m4v|gif|mp3|m4a|aac|opus|flac|wav|ogg|wma|srt|vtt|txt)$/i

function isUncOrDevicePath(value: string): boolean {
  return /^\\\\/.test(value) || /^\/\//.test(value)
}

export function validateDownloadInput(input: StartInput): void {
  if (!input || typeof input.url !== 'string' || input.url.length > 16384) {
    throw new Error('Invalid download URL')
  }
  try {
    const parsed = new URL(input.url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid download URL')
    }
  } catch {
    throw new Error('Invalid download URL')
  }
  if (
    typeof input.directory !== 'string' ||
    input.directory.length > 32767 ||
    !path.isAbsolute(input.directory) ||
    input.directory.includes('\0') ||
    isUncOrDevicePath(input.directory)
  ) {
    throw new Error('Invalid download directory')
  }
  if (
    input.filename !== undefined &&
    input.filename !== '' &&
    (typeof input.filename !== 'string' ||
      input.filename.length > 255 ||
      /[/\\]/.test(input.filename) ||
      input.filename.includes('\0') ||
      input.filename === '.' ||
      input.filename === '..')
  ) {
    throw new Error('Invalid filename')
  }
  if (input.subfolderName !== undefined && input.subfolderName !== '') {
    if (
      typeof input.subfolderName !== 'string' ||
      input.subfolderName.length > 255 ||
      input.subfolderName.includes('\0')
    ) {
      throw new Error('Invalid subfolder name')
    }
    const cleaned = input.subfolderName.replace(/[/\\:*?"<>|]/g, '').trim()
    if (cleaned === '.' || cleaned === '..') {
      throw new Error('Invalid subfolder name')
    }
  }
  if (
    input.targetFormat !== undefined &&
    (typeof input.targetFormat !== 'string' || !ALLOWED_TARGET_FORMATS.has(input.targetFormat))
  ) {
    throw new Error('Invalid target format')
  }
  if (
    input.engine !== undefined &&
    (typeof input.engine !== 'string' || !ALLOWED_ENGINES.has(input.engine))
  ) {
    throw new Error('Invalid download engine')
  }
  if (
    input.trimMode !== undefined &&
    (typeof input.trimMode !== 'string' || !ALLOWED_TRIM_MODES.has(input.trimMode))
  ) {
    throw new Error('Invalid trim mode')
  }
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  registerDownloadSubtitleIpc(deps)
  registerMediaLibraryIpc(deps.getWin)
  registerAnalysisIpcHandlers(deps)
  registerMediaIpcHandlers(deps)

  const {
    getWin,
    getDownloads,
    getUpdateService,
    getMediaPort,
    getMediaToken,
    serviceReadyPromise,
  } = deps

  const waitForEngines = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        serviceReadyPromise,
        new Promise<void>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Engines are not ready. Use Repair Engines.')),
            15000,
          )
          timer.unref()
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  ipcMain.on('log-message', (_event, level, message) => {
    if (
      _event.sender !== getWin()?.webContents ||
      !['info', 'warn', 'error', 'debug'].includes(level) ||
      typeof message !== 'string' ||
      message.length > 8192
    ) {
      return
    }
    const logger = log as unknown as Record<string, ((msg: string) => void) | undefined>
    if (log && typeof logger[level] === 'function') {
      logger[level]!(`[Renderer] ${message}`)
    } else {
      log?.info(`[Renderer] ${message}`)
    }
  })

  ipcMain.handle('cortexdl:update:state', async () => getUpdateService().getState())
  ipcMain.handle('cortexdl:check-for-updates', async () => getUpdateService().checkForUpdates(true))
  ipcMain.handle('cortexdl:update:download', async () => getUpdateService().downloadUpdate())
  ipcMain.handle('cortexdl:update:cancel', async () => getUpdateService().cancelDownload())
  ipcMain.handle('cortexdl:restart-app', async () => getUpdateService().quitAndInstall())

  ipcMain.handle('cortexdl:uninstall-app', () => {
    try {
      const uninstallerPath = path.join(path.dirname(app.getPath('exe')), 'Uninstall Cortex DL.exe')
      if (existsSync(uninstallerPath)) {
        const child = spawn(uninstallerPath, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
        child.unref()
      } else {
        log.error('Uninstaller not found at:', uninstallerPath)
        shell.openExternal('ms-settings:appsfeatures')
      }
      log.info('Exiting app...')
      app.quit()
    } catch (error) {
      log.error('Uninstall error:', error)
    }
  })

  ipcMain.handle('cortexdl:select-folder', async () => {
    const win = getWin()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return null
    const selected = result.filePaths[0] ?? null
    if (selected) {
      try {
        db.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)').run()
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
          'downloadDirectory',
          selected,
        )
      } catch (err) {
        log.error('[settings] Failed to persist downloadDirectory:', err)
      }
    }
    return selected
  })

  ipcMain.handle('cortexdl:secure-save', (_event, _key: string, value: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        log.warn('[safeStorage] Encryption not available. Returning failure.')
        return false
      }
      return safeStorage.encryptString(value).toString('base64')
    } catch (error) {
      log.error('[safeStorage] Failed to encrypt data', error)
      return false
    }
  })

  ipcMain.handle('cortexdl:secure-get', (_event, base64Value: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable() || !base64Value) return ''
      return safeStorage.decryptString(Buffer.from(base64Value, 'base64'))
    } catch (error) {
      log.error('[safeStorage] Failed to decrypt data', error)
      return ''
    }
  })

  ipcMain.handle('cortexdl:update-engine', async () => {
    const downloads = getDownloads()
    if (downloads && downloads.getActiveCount() > 0) {
      log.warn('[ytdlp] Engine auto-update aborted because active downloads are running.')
      return { success: false, message: 'Wait for downloads to complete before updating engine.' }
    }
    return await updateYtdlp()
  })

  ipcMain.handle('cortexdl:get-engine-version', async () => getYtdlpVersion())
  ipcMain.handle('cortexdl:check-js-runtime', async () => checkJsRuntime())

  ipcMain.handle('cortexdl:health-check', async () => {
    await deps.mediaReadyPromise?.catch(() => {})
    return getAppHealthCheck(getMediaPort(), getMediaToken(), deps.uiReadyPromise)
  })

  ipcMain.handle('cortexdl:downloads:list', async () => {
    const downloads = getDownloads()
    if (!downloads) throw new Error('Download history not initialized')
    return downloads.list()
  })

  ipcMain.handle('cortexdl:downloads:add', async (_event, input: StartInput) => {
    await waitForEngines()
    const downloads = getDownloads()
    if (!downloads) throw new Error('Download Manager not initialized')
    validateDownloadInput(input)
    return downloads.add(input)
  })

  ipcMain.handle('cortexdl:downloads:add-batch', async (_event, inputs: StartInput[]) => {
    await waitForEngines()
    const downloads = getDownloads()
    if (!downloads) throw new Error('Download Manager not initialized')
    if (!Array.isArray(inputs) || inputs.length > 500) throw new Error('Invalid download batch')
    inputs.forEach(validateDownloadInput)
    return downloads.addBatch(inputs)
  })

  ipcMain.handle('cortexdl:downloads:pause', async (_event, id: string) =>
    getDownloads()?.pause(id),
  )
  ipcMain.handle('cortexdl:downloads:resume', async (_event, id: string) =>
    getDownloads()?.resume(id),
  )
  ipcMain.handle('cortexdl:downloads:cancel', async (_event, id: string) =>
    getDownloads()?.cancel(id),
  )
  ipcMain.handle('cortexdl:downloads:delete', async (_event, id: string, deleteFile: boolean) =>
    getDownloads()?.delete(id, deleteFile),
  )
  ipcMain.handle('cortexdl:downloads:clear-completed', async () => getDownloads()?.clearCompleted())
  ipcMain.handle('cortexdl:downloads:pause-all', async () => getDownloads()?.pauseAll())
  ipcMain.handle('cortexdl:downloads:resume-all', async () => getDownloads()?.resumeAll())

  ipcMain.handle('cortexdl:set-concurrency', async (_event, value: number) => {
    if (!getDownloads()) await waitForEngines()
    getDownloads()?.setMaxConcurrent(value)
  })

  ipcMain.handle('cortexdl:get-concurrency', async () => {
    if (!getDownloads()) await waitForEngines()
    return getDownloads()?.getMaxConcurrent() ?? 3
  })

  const openExistingDirectory = async (dirPath: string): Promise<boolean> => {
    if (!existsSync(dirPath)) return false
    const stat = lstatSync(dirPath)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false
    const err = await shell.openPath(dirPath)
    if (err) throw new Error(err)
    return true
  }

  ipcMain.handle('cortexdl:open-folder', async (_event, filePath: string) => {
    const normalizedPath = path.normalize(filePath)
    if (isUncOrDevicePath(normalizedPath)) throw new Error('Invalid file path')
    try {
      if (existsSync(normalizedPath)) {
        const stat = lstatSync(normalizedPath)
        if (stat.isSymbolicLink()) throw new Error('Cannot open symbolic links')
        if (stat.isDirectory()) {
          const err = await shell.openPath(normalizedPath)
          if (err) throw new Error(err)
        } else {
          shell.showItemInFolder(normalizedPath)
        }
      } else {
        const dir = path.dirname(normalizedPath)
        if (!(await openExistingDirectory(dir))) {
          throw new Error('Folder does not exist')
        }
      }
    } catch (err) {
      log.error('Failed to open folder:', err)
      try {
        const dir = path.dirname(normalizedPath)
        if (await openExistingDirectory(dir)) return
      } catch (e) {
        log.error('Fallback open folder failed:', e)
      }
      throw err
    }
  })

  ipcMain.handle('cortexdl:open-file', async (_event, filePath: string) => {
    try {
      const normalizedPath = path.normalize(filePath)
      if (isUncOrDevicePath(normalizedPath)) throw new Error('Invalid file path')
      if (!existsSync(normalizedPath)) {
        throw new Error(`File not found on disk: ${normalizedPath}`)
      }
      const stat = lstatSync(normalizedPath)
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error('Target is not a regular file')
      }
      const resolvedPath = realpathSync(normalizedPath)
      if (!ALLOWED_OPEN_FILE_EXT.test(resolvedPath)) {
        throw new Error('Only media and text files can be opened')
      }
      const err = await shell.openPath(resolvedPath)
      if (err) throw new Error(err)
    } catch (err) {
      log.error('Failed to open file:', err)
      throw err
    }
  })

  ipcMain.handle('cortexdl:open-external', async (_event, url: string) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        log.warn('[Security] Blocked openExternal with non-http protocol:', parsed.protocol)
        return
      }
      await shell.openExternal(url)
    } catch {
      log.warn('[Security] Blocked openExternal with invalid URL')
    }
  })

  ipcMain.handle('cortexdl:show-main-window', () => {
    const win = getWin()
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
  })
}
