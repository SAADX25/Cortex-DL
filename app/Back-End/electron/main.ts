import log from 'electron-log'
import * as dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Initialization: set __dirname and load .env
const __dirname_env = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname_env, '..', '.env') })

// Configure pure electron-log globally FIRST
log.initialize({ preload: true })
log.transports.file.level = 'info'

import { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage, safeStorage } from 'electron'
import { existsSync, rmSync, statSync, createReadStream, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import { spawn } from 'node:child_process'
import type { DownloadManager } from './downloadManager'
import type { StartInput } from './types'
import { analyzeUrlForHls } from './hls'
import { analyzeWithYtdlp, isYtdlpAvailable, checkJsRuntime, updateYtdlp, getYtdlpVersion } from './ytdlp'
import { extractAndSaveComments } from './commentsExtractor'

// GPU Hardware Acceleration
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('enable-hardware-overlays')
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder,CanvasOopRasterization')

// Global Error Catchers
process.on('unhandledRejection', (reason) => {
  log.error('UNHANDLED REJECTION:', reason)
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Global Lazy-Loaded Variables (Strictly Typed)
let downloads: DownloadManager | null = null
let autoUpdater: typeof import('electron-updater').autoUpdater | null = null

// Service Ready Promise (Fixes Race Condition)
let serviceReadyResolve: () => void
const serviceReadyPromise = new Promise<void>(resolve => {
  serviceReadyResolve = resolve
})

// Auto-cleanup function for updater cache
function cleanupUpdaterCache() {
  try {
    const updaterCacheDir = path.join(app.getPath('userData'), '..', 'cortex-dl-updater')
    if (existsSync(updaterCacheDir)) {
      log?.info(`Cleaning up updater cache at: ${updaterCacheDir}`)
      rmSync(updaterCacheDir, { recursive: true, force: true })
    }
  } catch (error) {
    log?.error('Failed to cleanup updater cache:', error)
  }
}

async function loadBackendServices() {
  // 1. Dynamic Imports
  const { autoUpdater: electronUpdater } = await import('electron-updater')
  const { DownloadManager } = await import('./downloadManager')

  // 2. Initialize Globals
  autoUpdater = electronUpdater

  // 3. Configure AutoUpdater logging
  autoUpdater.logger = log
  autoUpdater.autoDownload = false // Pre-prompt before downloading

  // 4. Setup AutoUpdater Listeners
  autoUpdater.on('update-downloaded', async () => {
    log?.info('Update downloaded. Prompting for install...')
    if (win) win.webContents.send('update-status', { status: 'downloaded' })

    if (win) {
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        title: 'Update Ready',
        message: 'The update has been downloaded. Restart the app to install it now?',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1
      })

      if (result.response === 0) {
        autoUpdater?.quitAndInstall()
      }
    }
  })

  autoUpdater.on('checking-for-update', () => {
    if (win) win.webContents.send('update-status', { status: 'checking' })
  })

  autoUpdater.on('update-available', async (info: any) => {
    if (win) win.webContents.send('update-status', { status: 'available' })

    if (win) {
      const result = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) of Cortex DL is available. Would you like to download it now?`,
        buttons: ['Update Now', 'Later'],
        defaultId: 0,
        cancelId: 1
      })

      if (result.response === 0) {
        if (win) win.webContents.send('update-status', { status: 'downloading-started' })
        autoUpdater?.downloadUpdate()
      } else {
        if (win) win.webContents.send('update-status', { status: 'not-available' })
      }
    }
  })

  autoUpdater.on('update-not-available', () => {
    if (win) win.webContents.send('update-status', { status: 'not-available' })
  })

  autoUpdater.on('error', (err) => {
    if (win) win.webContents.send('update-status', { status: 'error', error: err.message })
  })

  autoUpdater.on('download-progress', (progressObj) => {
    if (win) win.webContents.send('update-status', { status: 'progress', percent: progressObj.percent })
  })

  // 5. Initialize DownloadManager
  if (win && !downloads) {
    downloads = new DownloadManager()
    downloads.attachWindow(win)
    log.info('[Backend] DownloadManager initialized')
  }

  // Signal that backend services are ready
  serviceReadyResolve()

  // Running startup checks
  log.info('Backend services loaded. Running startup checks...')
  cleanupUpdaterCache()
  
  try {
    await autoUpdater.checkForUpdatesAndNotify()
  } catch (err) {
    log.error('Deferred update check failed:', err)
  }
}

ipcMain.on('log-message', (_event, level, message) => {
  if (log && log[level as keyof typeof log]) {
    // @ts-expect-error log dynamic key
    log[level](`[Renderer] ${message}`)
  } else {
    log?.info(`[Renderer] ${message}`)
  }
})

ipcMain.handle('cortexdl:check-for-updates', async () => {
  autoUpdater?.checkForUpdates()
})

ipcMain.handle('cortexdl:restart-app', async () => {
  autoUpdater?.quitAndInstall()
})

ipcMain.handle('cortexdl:uninstall-app', () => {
  try {
    // 1. Path to uninstaller (usually in the executable's directory)
    // In dev, this might not exist, but in prod it should be next to the exe
    const uninstallerPath = path.join(path.dirname(app.getPath('exe')), 'unins000.exe')
    
    // 2. Path to User Data (AppData/Roaming/Cortex DL)
    const userDataPath = app.getPath('userData')

    log.info('Initiating Self-Destruct...')

    // 3. Wipe User Data (Force delete everything in AppData)
    if (existsSync(userDataPath)) {
      try {
        rmSync(userDataPath, { recursive: true, force: true })
        log.info('UserData wiped successfully.')
      } catch (err) {
        log.error('Failed to wipe UserData:', err)
      }
    }

    // 4. Launch Uninstaller (Detached so it stays alive after app quits)
    if (existsSync(uninstallerPath)) {
      const child = spawn(uninstallerPath, [], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref() // Allow uninstaller to run independently
    } else {
      log.error('Uninstaller not found at:', uninstallerPath)
      // Fallback: Open Add/Remove programs if uninstaller is missing
      shell.openExternal('ms-settings:appsfeatures')
    }

    // Exit immediately
    log.info('Exiting app...')
    app.exit(0)

  } catch (error) {
    log.error('Uninstall error:', error)
  }
})

process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'Front-End', 'dist')

let win: BrowserWindow | null
let tray: Tray | null = null
let isQuitting = false
// let downloads: DownloadManager | null = null

function createTray() {
  const iconPath = VITE_DEV_SERVER_URL 
    ? path.join(process.env.APP_ROOT, 'public', 'CortexDL.ico') 
    : path.join(RENDERER_DIST, 'CortexDL.ico');
    
  const trayIcon = nativeImage.createFromPath(iconPath);
  
  tray = new Tray(trayIcon);
  tray.setToolTip('Cortex DL');

  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Open Cortex DL', 
      click: () => win?.show() 
    }, 
    { type: 'separator' }, 
    { 
      label: 'Quit / Exit', 
      click: () => { 
        isQuitting = true; 
        app.quit(); 
      } 
    } 
  ]);

  tray.setContextMenu(contextMenu);

  // Restore window on single click 
  tray.on('click', () => { 
    if (win) win.show(); 
  });
}

function createWindow() {
    const iconPath = VITE_DEV_SERVER_URL 
      ? path.join(process.env.APP_ROOT, 'public', 'CortexDL.ico') 
      : path.join(RENDERER_DIST, 'CortexDL.ico');

  win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'Cortex DL',
    icon: iconPath,
    autoHideMenuBar: true,
    show: false, // Don't show immediately
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Remove native menu bar
  try {
    win.setMenu(null)
  } catch (err) {
    log.warn('Failed to remove menu:', err)
  }

  // Show window as soon as it's ready, to prevent "splash freeze"
  win.once('ready-to-show', () => {
    win?.show()
  })

  // Intercept the 'close' Event to minimize to tray
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault(); // STOP the close
      win?.hide();            // Just hide the window
      
      // Show a balloon notification on first hide (optional logic could go here)
      // For now, just a simple notification if supported
      /*
      if (tray) {
        tray.displayBalloon({
          title: 'Cortex DL is running',
          content: 'Downloads continue in the background. Right-click the icon to quit.'
        });
      }
      */
    }
    return false;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

ipcMain.handle('cortexdl:select-folder', async () => {
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled) return null
  return result.filePaths[0] ?? null
})

ipcMain.handle('cortexdl:select-cookies-file', async () => {
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

// SafeStorage for Secure Credentials
ipcMain.handle('cortexdl:secure-save', (_event, _key: string, value: string) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback for systems lacking keychain/encryption support
      log.warn('[safeStorage] Encryption not available. Returning failure.')
      return false
    }
    const encrypted = safeStorage.encryptString(value)
    // We store the encrypted buffer as Base64 in standard config files/store or localStorage proxy.
    // However, it's safer to use Electron's `store` or just let the frontend store the encrypted Base64 string in localStorage.
    // For simplicity of this proxy, we return the base64 payload to the frontend.
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

ipcMain.handle('cortexdl:check-engines', async () => {
  // Delay initial check slightly to allow UI to render first
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Lazy load isFfmpegAvailable from dedicated engine module
  const { isFfmpegAvailable } = await import('./ffmpegEngine')

  const [ytdlp, ffmpeg, jsRuntime] = await Promise.all([
    isYtdlpAvailable(),
    isFfmpegAvailable(),
    checkJsRuntime()
  ])
  
  return {
    ytdlp,
    ffmpeg,
    jsRuntime: jsRuntime.available,
    jsRuntimeName: jsRuntime.name
  }
})

ipcMain.handle('cortexdl:update-engine', async () => {
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
  return downloads?.list() || []
})

ipcMain.handle(
  'cortexdl:downloads:add',
  async (_event, input: StartInput) => {
    await serviceReadyPromise
    if (!downloads) throw new Error('Download Manager not initialized')
    return downloads.add(input)
  },
)

ipcMain.handle(
  'cortexdl:downloads:add-batch',
  async (_event, inputs: StartInput[]) => {
    await serviceReadyPromise
    if (!downloads) throw new Error('Download Manager not initialized')
    return downloads.addBatch(inputs)
  },
)

ipcMain.handle('cortexdl:downloads:pause', async (_event, id: string) => downloads?.pause(id))
ipcMain.handle('cortexdl:downloads:resume', async (_event, id: string) => downloads?.resume(id))
ipcMain.handle('cortexdl:downloads:cancel', async (_event, id: string) => downloads?.cancel(id))
ipcMain.handle('cortexdl:downloads:delete', async (_event, id: string, deleteFile: boolean) => downloads?.delete(id, deleteFile))
ipcMain.handle('cortexdl:downloads:clear-completed', async () => downloads?.clearCompleted())
ipcMain.handle('cortexdl:downloads:pause-all', async () => downloads?.pauseAll())
ipcMain.handle('cortexdl:downloads:resume-all', async () => downloads?.resumeAll())

ipcMain.handle('cortexdl:set-concurrency', async (_event, value: number) => {
  await serviceReadyPromise
  downloads?.setMaxConcurrent(value)
})

ipcMain.handle('cortexdl:get-concurrency', async () => {
  await serviceReadyPromise
  return downloads?.getMaxConcurrent() ?? 3
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
    // Fallback: Try to open the parent directory if showing item failed
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
    // Normalize the path to handle backslashes, special characters, etc.
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
  if (win) {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  }
})

ipcMain.handle('cortexdl:download-comments', async (_event, url: string) => {
  try {
    if (!win) return { success: false, error: 'No main window' }
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save Comments',
      defaultPath: 'comments.txt',
      filters: [{ name: 'Text Files', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return { success: false, canceled: true }

    // Send an event to say we are starting the actual extraction
    win.webContents.send('cortexdl:comments-extraction-started')

    const result = await extractAndSaveComments(url, filePath, (current, total) => {
      win?.webContents.send('cortexdl:comments-progress', current, total)
    })
    if (result) {
      // DONT show message box. Front-end handles it.
      return { success: true, filePath }
    } else {
      // DONT show message box. Front-end handles it.
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
    
    // If not HLS, try yt-dlp (covers YouTube, FB, Insta, etc.)
    const ytdlpResult = await analyzeWithYtdlp(url, browser)
    if (ytdlpResult.kind !== 'unknown') {
      return ytdlpResult
    }

    return hlsResult // fallback to direct/unknown
  } catch (err) {
    log.error('Analysis error:', err)
    throw err // Propagate the error to the frontend
  }
})

ipcMain.handle('cortexdl:fetch-thumbnail', async (_event, url: string) => {
  try {
    if (!url || typeof url !== 'string') throw new Error('Invalid URL')
    // Use global fetch (Node 18+) to request image with spoofed headers
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

    // Determine file extension from content-type
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/jpg': '.jpg',
      'image/png': '.png', 'image/webp': '.webp',
      'image/gif': '.gif', 'image/avif': '.avif',
    }
    const ext = extMap[contentType] || '.jpg'

    // Save to a temp directory under our app's namespace to avoid collisions
    const thumbCacheDir = path.join(os.tmpdir(), 'cortexdl-thumbs')
    if (!existsSync(thumbCacheDir)) mkdirSync(thumbCacheDir, { recursive: true })

    // Hash the URL to create a deterministic, collision-free filename
    const hash = Buffer.from(url).toString('base64url').slice(0, 32)
    const filePath = path.join(thumbCacheDir, `${hash}${ext}`)

    // Only write if not already cached
    if (!existsSync(filePath)) {
      writeFileSync(filePath, buf)
    }

    return filePath
  } catch (err) {
    log.error('[fetch-thumbnail] failed for', url, err)
    throw err
  }
})

// IPC handler: expose the dynamically resolved media server port to the renderer
ipcMain.handle('cortexdl:get-media-port', () => MEDIA_SERVER_PORT)
// Hardware acceleration is actively enabled for smooth UI/video playback
// app.disableHardwareAcceleration()
const gotTheLock = app.requestSingleInstanceLock()
// Media Streaming Server

// Media Server Port (default to constant value if not found in .env)
// Uses `let` so it can be reassigned when the preferred port is busy.
const MEDIA_SERVER_PORT_BASE = Number(process.env.MEDIA_SERVER_PORT) || 3345
const MEDIA_SERVER_PORT_MAX_TRIES = 10
export let MEDIA_SERVER_PORT = MEDIA_SERVER_PORT_BASE
let mediaServer: http.Server | null = null

const MIME_TYPES: Record<string, string> = {
  '.mp4':  'video/mp4',
  '.mkv':  'video/x-matroska',
  '.avi':  'video/x-msvideo',
  '.mov':  'video/quicktime',
  '.webm': 'video/webm',
  '.ogv':  'video/ogg',
  '.m4v':  'video/mp4',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.m4a':  'audio/mp4',
  '.ogg':  'audio/ogg',
  '.flac': 'audio/flac',
  '.aac':  'audio/aac',
  '.opus': 'audio/opus',
  '.wma':  'audio/x-ms-wma',
  // Image types — used by the thumbnail proxy
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.avif': 'image/avif',
}

function startMediaStreamingServer(): void {
  if (mediaServer) return // already running

  // The allowed origin is VITE_DEV_SERVER_URL in dev, and 'file://' in production.
  const devUrl = VITE_DEV_SERVER_URL ? VITE_DEV_SERVER_URL.replace(/\/$/, '') : null
  const appOrigin = devUrl || 'file://'

  const server = http.createServer((req, res) => {
    // 1. Origin Validation
    const requestOrigin = req.headers.origin
    
    // Media elements (video/audio) may send null or missing origin in file:// context.
    if (requestOrigin && requestOrigin !== appOrigin && requestOrigin !== 'null') {
      res.writeHead(403)
      res.end('Unauthorized origin')
      return
    }

    // CORS pre-flight
    // Use the actual requestOrigin to satisfy CORS constraints, fallback to '*' or appOrigin.
    const corsOrigin = requestOrigin && requestOrigin !== 'null' ? requestOrigin : '*'
    res.setHeader('Access-Control-Allow-Origin', corsOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Range')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      const urlObj = new URL(req.url ?? '/', `http://127.0.0.1:${MEDIA_SERVER_PORT}`)
      const rawFilePath = urlObj.searchParams.get('path')

      if (!rawFilePath) {
        res.writeHead(400)
        res.end('Missing path parameter')
        return
      }

      // Normalize to resolve any '..' traversal attempts, then validate
      const filePath = path.normalize(rawFilePath)
      if (!path.isAbsolute(filePath)) {
        res.writeHead(400)
        res.end('Path must be absolute')
        return
      }

      const ext = path.extname(filePath).toLowerCase()
      if (!MIME_TYPES[ext]) {
        res.writeHead(403)
        res.end('Forbidden file type')
        return
      }

      if (!existsSync(filePath)) {
        res.writeHead(404)
        res.end('File not found')
        return
      }

      const stat = statSync(filePath)
      const fileSize = stat.size
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
      const rangeHeader = req.headers['range']

      if (rangeHeader) {
        // ── 206 Partial Content ─────────────────────────────────────────
        // Required for seeking, scrubbing, and proper duration detection.
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        const start = match ? parseInt(match[1], 10) : 0
        const end   = (match && match[2]) ? parseInt(match[2], 10) : fileSize - 1
        const clampedEnd = Math.min(end, fileSize - 1)
        const chunkSize = clampedEnd - start + 1

        res.writeHead(206, {
          'Content-Range':  `bytes ${start}-${clampedEnd}/${fileSize}`,
          'Accept-Ranges':  'bytes',
          'Content-Length': chunkSize,
          'Content-Type':   contentType,
        })
        const stream206 = createReadStream(filePath, { start, end: clampedEnd })
        req.on('close',   () => stream206.destroy())
        req.on('aborted', () => stream206.destroy())
        stream206.pipe(res)
      } else {
        // ── 200 Full Response ────────────────────────────────────
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type':   contentType,
          'Accept-Ranges':  'bytes',
        })
        if (req.method === 'HEAD') {
          res.end()
        } else {
          const stream200 = createReadStream(filePath)
          req.on('close',   () => stream200.destroy())
          req.on('aborted', () => stream200.destroy())
          stream200.pipe(res)
        }
      }
    } catch (err) {
      log.error('[MediaServer] Error:', err)
      if (!res.headersSent) {
        res.writeHead(500)
        res.end('Internal server error')
      }
    }
  })

  /**
   * Attempt to listen on MEDIA_SERVER_PORT. If the port is already in use
   * (EADDRINUSE), automatically try the next port up to MEDIA_SERVER_PORT_MAX_TRIES
   * attempts before giving up.
   */
  let attempt = 0

  const tryListen = (port: number) => {
    MEDIA_SERVER_PORT = port
    server.listen(port, '127.0.0.1')
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      attempt++
      const nextPort = MEDIA_SERVER_PORT_BASE + attempt
      if (attempt < MEDIA_SERVER_PORT_MAX_TRIES) {
        log.warn(`[MediaServer] Port ${MEDIA_SERVER_PORT} in use, trying ${nextPort}…`)
        server.close() // Release before retrying
        tryListen(nextPort)
      } else {
        log.error(`[MediaServer] All ports ${MEDIA_SERVER_PORT_BASE}–${nextPort} are in use. Media server could not start.`)
      }
    } else {
      log.error('[MediaServer] Server error:', err)
    }
  })

  server.on('listening', () => {
    mediaServer = server
    log.info(`[MediaServer] Streaming server ready at http://127.0.0.1:${MEDIA_SERVER_PORT}`)
  })

  tryListen(MEDIA_SERVER_PORT)
}

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
  })

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on('before-quit', () => {
    isQuitting = true
    downloads?.flushPendingSave()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
      win = null
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // Non-Blocking Initialization
  app.whenReady().then(async () => {
    startMediaStreamingServer()
    createWindow()
    if (!tray) createTray()

    setTimeout(() => {
      loadBackendServices().catch((err) => {
        log.error('[Backend] loadBackendServices failed — downloads will not work:', err)
        serviceReadyResolve()
      })
    }, 1500)
  })
}

