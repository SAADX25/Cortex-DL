import { app, dialog, ipcMain, shell, safeStorage } from 'electron'
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import log from 'electron-log'
import { spawn } from 'node:child_process'
import type { DownloadManager } from '../downloadManager'
import type { StartInput } from '../types'
import { analyzeUrlForHls } from '../hls'
import { analyzeWithYtdlp, updateYtdlp, getYtdlpVersion, getDirectStreamUrl } from '../ytdlp'
import { extractAndSaveComments } from '../commentsExtractor'

export interface IpcDependencies {
  getWin: () => Electron.BrowserWindow | null
  getDownloads: () => DownloadManager | null
  getAutoUpdater: () => typeof import('electron-updater').autoUpdater | null
  getMediaPort: () => number
  serviceReadyPromise: Promise<void>
}

export function registerIpcHandlers(deps: IpcDependencies) {
  const { getWin, getDownloads, getAutoUpdater, getMediaPort, serviceReadyPromise } = deps

  ipcMain.on('log-message', (_event, level, message) => {
    if (log && log[level as keyof typeof log]) {
      // @ts-expect-error log dynamic key
      log[level](`[Renderer] ${message}`)
    } else {
      log?.info(`[Renderer] ${message}`)
    }
  })

  ipcMain.handle('cortexdl:check-for-updates', async () => {
    const autoUpdater = getAutoUpdater()
    autoUpdater?.checkForUpdates()
  })

  ipcMain.handle('cortexdl:restart-app', async () => {
    const autoUpdater = getAutoUpdater()
    autoUpdater?.quitAndInstall()
  })

  ipcMain.handle('cortexdl:uninstall-app', () => {
    try {
      const uninstallerPath = path.join(path.dirname(app.getPath('exe')), 'unins000.exe')
      const userDataPath = app.getPath('userData')

      log.info('Initiating Self-Destruct...')

      if (existsSync(userDataPath)) {
        try {
          rmSync(userDataPath, { recursive: true, force: true })
          log.info('UserData wiped successfully.')
        } catch (err) {
          log.error('Failed to wipe UserData:', err)
        }
      }

      if (existsSync(uninstallerPath)) {
        const child = spawn(uninstallerPath, [], {
          detached: true,
          stdio: 'ignore'
        })
        child.unref()
      } else {
        log.error('Uninstaller not found at:', uninstallerPath)
        shell.openExternal('ms-settings:appsfeatures')
      }

      log.info('Exiting app...')
      app.exit(0)
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
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('cortexdl:select-cookies-file', async () => {
    const win = getWin()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Cookies', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('cortexdl:secure-save', (_event, _key: string, value: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        log.warn('[safeStorage] Encryption not available. Returning failure.')
        return false
      }
      const encrypted = safeStorage.encryptString(value)
      return encrypted.toString('base64')
    } catch (error) {
      log.error('[safeStorage] Failed to encrypt data', error)
      return false
    }
  })

  ipcMain.handle('cortexdl:secure-get', (_event, base64Value: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable() || !base64Value) return ''
      const buffer = Buffer.from(base64Value, 'base64')
      return safeStorage.decryptString(buffer)
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

  ipcMain.handle('cortexdl:get-engine-version', async () => {
    return getYtdlpVersion()
  })

  ipcMain.handle('cortexdl:downloads:list', async () => {
    await serviceReadyPromise
    const downloads = getDownloads()
    return downloads?.list() || []
  })

  ipcMain.handle('cortexdl:downloads:add', async (_event, input: StartInput) => {
    await serviceReadyPromise
    const downloads = getDownloads()
    if (!downloads) throw new Error('Download Manager not initialized')
    return downloads.add(input)
  })

  ipcMain.handle('cortexdl:downloads:add-batch', async (_event, inputs: StartInput[]) => {
    await serviceReadyPromise
    const downloads = getDownloads()
    if (!downloads) throw new Error('Download Manager not initialized')
    return downloads.addBatch(inputs)
  })

  ipcMain.handle('cortexdl:downloads:pause', async (_event, id: string) => getDownloads()?.pause(id))
  ipcMain.handle('cortexdl:downloads:resume', async (_event, id: string) => getDownloads()?.resume(id))
  ipcMain.handle('cortexdl:downloads:cancel', async (_event, id: string) => getDownloads()?.cancel(id))
  ipcMain.handle('cortexdl:downloads:delete', async (_event, id: string, deleteFile: boolean) => getDownloads()?.delete(id, deleteFile))
  ipcMain.handle('cortexdl:downloads:clear-completed', async () => getDownloads()?.clearCompleted())
  ipcMain.handle('cortexdl:downloads:pause-all', async () => getDownloads()?.pauseAll())
  ipcMain.handle('cortexdl:downloads:resume-all', async () => getDownloads()?.resumeAll())

  ipcMain.handle('cortexdl:set-concurrency', async (_event, value: number) => {
    await serviceReadyPromise
    getDownloads()?.setMaxConcurrent(value)
  })

  ipcMain.handle('cortexdl:get-concurrency', async () => {
    await serviceReadyPromise
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
          throw new Error('المجلد غير موجود')
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

  ipcMain.handle('cortexdl:download-comments', async (_event, url: string) => {
    try {
      const win = getWin()
      if (!win) return { success: false, error: 'No main window' }
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Save Comments',
        defaultPath: 'comments.txt',
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
      })
      if (canceled || !filePath) return { success: false, canceled: true }

      win.webContents.send('cortexdl:comments-extraction-started')

      const result = await extractAndSaveComments(url, filePath, (current, total) => {
        win.webContents.send('cortexdl:comments-progress', current, total)
      })
      if (result) {
        return { success: true, filePath }
      } else {
        return { success: false, error: 'Extraction failed' }
      }
    } catch (e: any) {
      log.error('[main] Error in download-comments:', e)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('cortexdl:analyze-url', async (_event, url: string, browser?: string) => {
    try {
      const hlsResult = await analyzeUrlForHls(url)
      if (hlsResult.kind !== 'unknown' && hlsResult.kind !== 'direct') {
        return hlsResult
      }
      
      const ytdlpResult = await analyzeWithYtdlp(url, browser)
      if (ytdlpResult.kind !== 'unknown') {
        return ytdlpResult
      }

      return hlsResult
    } catch (err) {
      log.error('Analysis error:', err)
      throw err
    }
  })

  ipcMain.handle('cortexdl:get-direct-stream-url', async (_event, url: string, browser?: string) => {
    try {
      log.info(`[IPC] get-direct-stream-url called for: ${url.slice(0, 80)}...`)
      const directUrl = await getDirectStreamUrl(url, browser)
      return directUrl
    } catch (err) {
      log.error('[IPC] get-direct-stream-url error:', err)
      throw err
    }
  })

  ipcMain.handle('cortexdl:get-media-fps', async (_event, filePath: string) => {
    try {
      const { MediaProcessor } = await import('../engines/MediaProcessor')
      const processor = new MediaProcessor()
      return await processor.getFps(filePath)
    } catch (err) {
      log.error('Failed to get media FPS:', err)
      return null
    }
  })

  ipcMain.handle('cortexdl:fetch-thumbnail', async (_event, url: string) => {
    try {
      if (!url || typeof url !== 'string') throw new Error('Invalid URL')
      const res = await fetch(url, {
        headers: {
          'Referer': 'https://www.instagram.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      } as any)

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const contentType = res.headers.get('content-type') || 'image/jpeg'
      const arr = await res.arrayBuffer()
      const buf = Buffer.from(arr)

      const extMap: Record<string, string> = {
        'image/jpeg': '.jpg', 'image/jpg': '.jpg',
        'image/png': '.png', 'image/webp': '.webp',
        'image/gif': '.gif', 'image/avif': '.avif',
      }
      const ext = extMap[contentType] || '.jpg'

      const thumbCacheDir = path.join(os.tmpdir(), 'cortexdl-thumbs')
      if (!existsSync(thumbCacheDir)) mkdirSync(thumbCacheDir, { recursive: true })

      const hash = Buffer.from(url).toString('base64url').slice(0, 32)
      const filePath = path.join(thumbCacheDir, `${hash}${ext}`)

      if (!existsSync(filePath)) {
        writeFileSync(filePath, buf)
      }

      return filePath
    } catch (err) {
      log.error('[fetch-thumbnail] failed for', url, err)
      throw err
    }
  })

  ipcMain.handle('cortexdl:get-media-port', () => getMediaPort())
}
