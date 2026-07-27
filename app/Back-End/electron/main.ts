import log from 'electron-log'
import * as dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname_env = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname_env, '..', '.env') })

log.initialize({ preload: true })
log.transports.file.level = 'info'

import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { existsSync, rmSync, statSync, createReadStream } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import type { DownloadManager } from './downloadManager'
import { registerIpcHandlers } from './ipc/handlers'
import { createTray } from './tray'
import { db } from './db'
import { spawn } from 'node:child_process'
import { getBinaryPath } from './paths'

app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization')

process.on('unhandledRejection', (reason) => {
  log.error('UNHANDLED REJECTION:', reason)
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let downloads: DownloadManager | null = null
let autoUpdater: typeof import('electron-updater').autoUpdater | null = null

let serviceReadyResolve: () => void
const serviceReadyPromise = new Promise<void>(resolve => {
  serviceReadyResolve = resolve
})

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
  
  const { autoUpdater: electronUpdater } = await import('electron-updater')
  const { DownloadManager } = await import('./downloadManager')

  
  autoUpdater = electronUpdater

  
  autoUpdater.logger = log
  autoUpdater.autoDownload = false 

  
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

  
  if (win && !downloads) {
    downloads = new DownloadManager()
    downloads.attachWindow(win)
    log.info('[Backend] DownloadManager initialized')
  }

  
  serviceReadyResolve()

  
  log.info('Backend services loaded. Running startup checks...')
  cleanupUpdaterCache()
  
  try {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log.error('Deferred update check failed:', err)
    })
  } catch (err) {
    log.error('Deferred update check failed:', err)
  }
}

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'Front-End', 'dist')

let win: BrowserWindow | null = null
let isQuitting = false

function initTray() {
  const iconPath = VITE_DEV_SERVER_URL 
    ? path.join(process.env.APP_ROOT, 'public', 'CortexDL.ico') 
    : path.join(RENDERER_DIST, 'CortexDL.ico');
    
  createTray(
    iconPath,
    () => win,
    () => { isQuitting = true }
  )
}

function createWindow() {
  const iconPath = VITE_DEV_SERVER_URL 
    ? path.join(process.env.APP_ROOT, 'public', 'CortexDL.ico') 
    : path.join(RENDERER_DIST, 'CortexDL.ico');

  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 850,
    minHeight: 580,
    title: 'Cortex DL',
    icon: iconPath,
    autoHideMenuBar: true,
    show: false, 
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  
  try {
    win.setMenu(null)
  } catch (err) {
    log.warn('Failed to remove menu:', err)
  }

  
  win.once('ready-to-show', () => {
    win?.show()
  })

  
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault(); 
      win?.hide();            
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
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  
  const MEDIA_CORS_WHITELIST = [
    /(^|\.)googlevideo\.com$/i,   
    /(^|\.)youtube\.com$/i,
    /(^|\.)ytimg\.com$/i,
    /(^|\.)fbcdn\.net$/i,
    /(^|\.)akamaihd\.net$/i,
    /(^|\.)tiktokcdn\.com$/i,
    /(^|\.)vimeocdn\.com$/i,
  ]

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      const rawUrl = details.url
      if (!rawUrl.startsWith('http')) return callback({ responseHeaders: details.responseHeaders })
      const { hostname } = new URL(rawUrl)
      const allowed = MEDIA_CORS_WHITELIST.some((re) => re.test(hostname))
      if (allowed) {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Access-Control-Allow-Origin': ['*'],
          },
        })
      } else {
        callback({ responseHeaders: details.responseHeaders })
      }
    } catch {
      callback({ responseHeaders: details.responseHeaders })
    }
  })
}

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
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.avif': 'image/avif',
  '.vtt':  'text/vtt',
  '.srt':  'text/plain',
}

function startMediaStreamingServer(): void {
  if (mediaServer) return

  const devUrl = VITE_DEV_SERVER_URL ? VITE_DEV_SERVER_URL.replace(/\/$/, '') : null
  const appOrigin = devUrl || 'file://'

  const server = http.createServer((req, res) => {
    const requestOrigin = req.headers.origin
    
    if (requestOrigin && requestOrigin !== appOrigin && requestOrigin !== 'null') {
      res.writeHead(403)
      res.end('Unauthorized origin')
      return
    }

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

      const filePath = path.normalize(rawFilePath)
      if (!path.isAbsolute(filePath)) {
        res.writeHead(400)
        res.end('Path must be absolute')
        return
      }

      
      const downloadsDir = app.getPath('downloads')
      const thumbsDir = path.join(os.tmpdir(), 'cortexdl-thumbs')
      const candidateRoots = new Set<string>([downloadsDir, thumbsDir])
      const settingsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get('settings') as { name: string } | undefined
      if (settingsTable) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('downloadDirectory') as { value: string } | undefined
        const configuredDir = row?.value
        if (configuredDir) candidateRoots.add(configuredDir)
      }
      const tasks = downloads ? downloads.list() : []
      for (const t of tasks) {
        if (t.directory) candidateRoots.add(t.directory)
      }
      const isUnder = (p: string, root: string) => {
        const pNorm = path.normalize(p).toLowerCase()
        const rootNorm = path.normalize(root).toLowerCase()
        const rel = path.relative(rootNorm, pNorm)
        return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
      }
      let allowed = false
      for (const root of candidateRoots) {
        if (isUnder(filePath, root)) { allowed = true; break }
      }
      if (!allowed) {
        res.writeHead(403)
        res.end('Forbidden path')
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

      const isSubtitleReq = urlObj.searchParams.get('subtitle') === 'true'
      if (isSubtitleReq) {
        const streamIndex = urlObj.searchParams.get('streamIndex') || '0'
        res.writeHead(200, {
          'Content-Type': 'text/vtt',
          'Access-Control-Allow-Origin': corsOrigin
        })

        if (req.method === 'HEAD') {
          res.end()
          return
        }

        const ffmpegPath = getBinaryPath('ffmpeg')
        const p = spawn(ffmpegPath, [
          '-i', filePath,
          '-map', `0:${streamIndex}`,
          '-f', 'webvtt',
          'pipe:1'
        ], { windowsHide: true })

        p.stdout.pipe(res)
        
        req.on('close', () => p.kill('SIGKILL'))
        req.on('aborted', () => p.kill('SIGKILL'))
        p.on('error', (err) => {
          log.error('[MediaServer] FFmpeg subtitle extraction error:', err)
          if (!res.headersSent) res.end()
        })
        return
      }

      const stat = statSync(filePath)
      const fileSize = stat.size
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
      const rangeHeader = req.headers['range']

      if (rangeHeader) {
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
        server.close()
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

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
  })

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

  
  registerIpcHandlers({
    getWin: () => win,
    getDownloads: () => downloads,
    getAutoUpdater: () => autoUpdater,
    getMediaPort: () => MEDIA_SERVER_PORT,
    serviceReadyPromise
  })

  app.whenReady().then(async () => {
    startMediaStreamingServer()
    createWindow()
    initTray()

    setTimeout(() => {
      loadBackendServices().catch((err) => {
        log.error('[Backend] loadBackendServices failed — downloads will not work:', err)
        serviceReadyResolve()
      })
    }, 100)
  })
}
