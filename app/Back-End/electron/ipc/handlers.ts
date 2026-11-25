// Main IPC handler registry orchestrating downloads, system/update/credentials, analysis, media, and library channels
import { app, dialog, ipcMain, shell, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import { spawn } from 'node:child_process'
import { type DownloadManager } from '../downloadManager'
import { type StartInput } from '../types'
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

function validateDownloadInput(input: StartInput): void {
  if (
    !input ||
    typeof input.url !== 'string' ||
    input.url.length > 16384 ||
    !/^https?:\/\//i.test(input.url)
  ) {
    throw new Error('Invalid download URL')
  }
  if (
    typeof input.directory !== 'string' ||
    !path.isAbsolute(input.directory) ||
    input.directory.includes('\0')
  ) {
    throw new Error('Invalid download directory')
  }
  if (
    input.filename &&
    (typeof input.filename !== 'string' ||
      /[/\\]/.test(input.filename) ||
      input.filename.includes('\0') ||
      input.filename === '..')
  ) {
    throw new Error('Invalid filename')
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

  ipcMain.handle('cortexdl:open-folder', async (_event, filePath: string) => {
    try {
      const normalizedPath = path.normalize(filePath)
      if (existsSync(normalizedPath)) {
        shell.showItemInFolder(normalizedPath)
      } else {
        const dir = path.dirname(normalizedPath)
        if (existsSync(dir)) {
          const err = await shell.openPath(dir)
          if (err) throw new Error(err)
        } else {
          throw new Error('Folder does not exist')
        }
      }
    } catch (err) {
      log.error('Failed to open folder:', err)
      try {
        const dir = path.dirname(filePath)
        if (existsSync(dir)) {
          await shell.openPath(dir)
          return
        }
      } catch (e) {
        log.error('Fallback open folder failed:', e)
      }
      throw err
    }
  })

  ipcMain.handle('cortexdl:open-file', async (_event, filePath: string) => {
    try {
      const normalizedPath = path.normalize(filePath)
      if (existsSync(normalizedPath)) {
        const err = await shell.openPath(normalizedPath)
        if (err) throw new Error(err)
      } else {
        throw new Error(`File not found on disk: ${normalizedPath}`)
      }
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
