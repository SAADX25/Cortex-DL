import log from 'electron-log'
import * as dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname_env = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname_env, '..', '.env') })

log.initialize({ preload: true })
log.transports.file.level = 'info'

import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { existsSync, rmSync, createReadStream, promises as fsPromises } from 'node:fs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import { DownloadManager } from './downloadManager'
import { runSetup } from './setup'

export let downloads: DownloadManager | null = null
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

/**
 * Per-launch capability token for the local media server.
 *
 * The server reads files off the user's disk, so it must be unreachable by any
 * other process or web page on the machine. Request origin cannot be that
 * boundary: Chromium sends `Origin: null` for `file://` documents (our packaged
 * renderer) and omits the header entirely for plain <img>/<video> loads, so any
 * local client can trivially reproduce an "allowed" origin. Instead every
 * request must present `?token=<MEDIA_SERVER_TOKEN>`; the value is regenerated
 * on each launch and handed to the renderer over IPC only.
 */
export const MEDIA_SERVER_TOKEN = randomBytes(32).toString('hex')
const MEDIA_TOKEN_BUFFER = Buffer.from(MEDIA_SERVER_TOKEN, 'utf8')

function isValidMediaToken(candidate: string | null): boolean {
  if (!candidate) return false
  const provided = Buffer.from(candidate, 'utf8')
  if (provided.length !== MEDIA_TOKEN_BUFFER.length) return false
  return timingSafeEqual(provided, MEDIA_TOKEN_BUFFER)
}

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

/**
 * Compiled once and reused. The media server touches settings on every request,
 * and `db.prepare()` recompiles SQL synchronously on the main thread.
 */
let settingsValueStmt: ReturnType<typeof db.prepare> | null = null

function readSettingValue(key: string): string | null {
  try {
    if (!settingsValueStmt) {
      settingsValueStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
    }
    const row = settingsValueStmt.get(key) as { value?: string } | undefined
    return row?.value ?? null
  } catch (err) {
    log.warn(`[MediaServer] Failed to read setting '${key}':`, err)
    return null
  }
}

const MEDIA_ROOTS_TTL_MS = 5_000
let mediaRootsCache: { roots: string[]; builtAtMs: number } | null = null

async function buildMediaRoots(): Promise<string[]> {
  const candidates = new Set<string>()
  candidates.add(app.getPath('downloads'))
  candidates.add(path.join(os.tmpdir(), 'cortexdl-thumbs'))

  const configuredDir = readSettingValue('downloadDirectory')
  if (configuredDir) candidates.add(configuredDir)

  const tasks = downloads ? downloads.list() : []
  for (const task of tasks) {
    if (task.directory) candidates.add(task.directory)
  }

  // Roots are symlink-resolved as well, so they can be compared against the
  // resolved request path. (On macOS os.tmpdir() is itself a symlink.)
  const roots: string[] = []
  for (const candidate of candidates) {
    try {
      roots.push(await fsPromises.realpath(candidate))
    } catch {
      roots.push(path.resolve(candidate))
    }
  }
  return roots
}

async function getMediaRoots(forceRebuild: boolean): Promise<string[]> {
  const now = Date.now()
  if (!forceRebuild && mediaRootsCache && now - mediaRootsCache.builtAtMs < MEDIA_ROOTS_TTL_MS) {
    return mediaRootsCache.roots
  }
  const roots = await buildMediaRoots()
  mediaRootsCache = { roots, builtAtMs: now }
  return roots
}

function isUnderRoot(target: string, root: string): boolean {
  const rel = path.relative(root, target)
  if (!rel) return false
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * True when `target` sits inside a directory the app is allowed to serve.
 * A miss forces a single cache rebuild, so a file in a brand-new task folder is
 * never rejected merely because the cached root list is a few seconds stale.
 */
async function isServablePath(target: string): Promise<boolean> {
  const resolved = path.resolve(target)

  const cachedRoots = await getMediaRoots(false)
  if (cachedRoots.some((root) => isUnderRoot(resolved, root))) return true

  const freshRoots = await getMediaRoots(true)
  return freshRoots.some((root) => isUnderRoot(resolved, root))
}

/** Blocks DNS-rebinding: only loopback Host headers are accepted. */
function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  const withoutPort = hostHeader.replace(/:\d+$/, '').toLowerCase()
  return withoutPort === '127.0.0.1' || withoutPort === 'localhost' || withoutPort === '[::1]'
}

/**
 * Defence in depth only — the capability token is the real gate. A missing
 * Origin (plain <img>/<video> load) and the literal `null` (a `file://`
 * document using `crossOrigin="anonymous"`) are both legitimate for us.
 */
function isAllowedOrigin(origin: string | undefined, appOrigin: string): boolean {
  if (!origin || origin === 'null') return true
  return origin === appOrigin
}

const SUBTITLE_EXTRACT_TIMEOUT_MS = 30_000

function streamEmbeddedSubtitle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
  rawStreamIndex: string | null,
  corsOrigin: string,
): void {
  // Only a bare stream number is accepted; anything else could select an
  // unintended (e.g. video) stream and produce a huge conversion.
  const streamIndex = rawStreamIndex && /^\d{1,3}$/.test(rawStreamIndex) ? rawStreamIndex : '0'

  res.writeHead(200, {
    'Content-Type': 'text/vtt',
    'Access-Control-Allow-Origin': corsOrigin,
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  const ffmpegPath = getBinaryPath('ffmpeg')
  if (!existsSync(ffmpegPath)) {
    log.warn('[MediaServer] ffmpeg is missing — cannot extract embedded subtitles')
    res.end()
    return
  }

  const child = spawn(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', filePath,
    '-map', `0:${streamIndex}`,
    '-f', 'webvtt',
    'pipe:1'
  ], { windowsHide: true })

  let finished = false

  const finish = () => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    try { child.kill('SIGKILL') } catch { /* already exited */ }
    if (!res.writableEnded) res.end()
  }

  const timer = setTimeout(() => {
    log.warn(`[MediaServer] Subtitle extraction timed out for stream ${streamIndex}`)
    finish()
  }, SUBTITLE_EXTRACT_TIMEOUT_MS)

  // stderr MUST be drained. ffmpeg blocks once the OS pipe buffer fills, which
  // would hang this request (and leak the process) forever.
  let stderrTail = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-8192)
  })

  child.stdout.pipe(res)

  child.on('error', (err) => {
    log.error('[MediaServer] FFmpeg subtitle extraction error:', err)
    finish()
  })

  child.on('close', (code) => {
    if (code !== 0 && stderrTail.trim()) {
      log.warn(`[MediaServer] FFmpeg subtitle exit ${code}: ${stderrTail.trim()}`)
    }
    finished = true
    clearTimeout(timer)
    if (!res.writableEnded) res.end()
  })

  res.on('close', finish)
  req.on('aborted', finish)
}

function pipeFileStream(
  stream: ReturnType<typeof createReadStream>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const destroy = () => {
    if (!stream.destroyed) stream.destroy()
  }

  res.on('close', destroy)
  req.on('aborted', destroy)

  stream.on('error', (err) => {
    log.error('[MediaServer] Read stream error:', err)
    destroy()
    if (!res.writableEnded) res.end()
  })

  stream.pipe(res)
}

async function handleMediaRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  appOrigin: string,
): Promise<void> {
  try {
    if (!isLoopbackHost(req.headers.host)) {
      res.writeHead(403)
      res.end('Forbidden host')
      return
    }

    const requestOrigin = req.headers.origin
    if (!isAllowedOrigin(requestOrigin, appOrigin)) {
      res.writeHead(403)
      res.end('Unauthorized origin')
      return
    }

    const corsOrigin = requestOrigin && requestOrigin !== 'null' ? requestOrigin : '*'
    res.setHeader('Access-Control-Allow-Origin', corsOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Range')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
    res.setHeader('Cache-Control', 'no-store')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Allow': 'GET, HEAD, OPTIONS' })
      res.end('Method not allowed')
      return
    }

    const urlObj = new URL(req.url ?? '/', `http://127.0.0.1:${MEDIA_SERVER_PORT}`)

    if (!isValidMediaToken(urlObj.searchParams.get('token'))) {
      log.warn('[MediaServer] Rejected a request that carried no valid capability token')
      res.writeHead(401)
      res.end('Unauthorized')
      return
    }

    const rawFilePath = urlObj.searchParams.get('path')
    if (!rawFilePath || rawFilePath.includes('\0')) {
      res.writeHead(400)
      res.end('Missing or invalid path parameter')
      return
    }

    const requestedPath = path.normalize(rawFilePath)
    if (!path.isAbsolute(requestedPath)) {
      res.writeHead(400)
      res.end('Path must be absolute')
      return
    }

    // Resolve symlinks *before* the allow-list check so a link planted inside a
    // served directory cannot point at an arbitrary location on disk.
    let filePath: string
    try {
      filePath = await fsPromises.realpath(requestedPath)
    } catch {
      res.writeHead(404)
      res.end('File not found')
      return
    }

    if (!(await isServablePath(filePath))) {
      res.writeHead(403)
      res.end('Forbidden path')
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext]
    if (!contentType) {
      res.writeHead(403)
      res.end('Forbidden file type')
      return
    }

    let stat: Awaited<ReturnType<typeof fsPromises.stat>>
    try {
      stat = await fsPromises.stat(filePath)
    } catch {
      res.writeHead(404)
      res.end('File not found')
      return
    }

    if (!stat.isFile()) {
      res.writeHead(403)
      res.end('Not a regular file')
      return
    }

    if (urlObj.searchParams.get('subtitle') === 'true') {
      streamEmbeddedSubtitle(req, res, filePath, urlObj.searchParams.get('streamIndex'), corsOrigin)
      return
    }

    const fileSize = stat.size
    const rangeHeader = req.headers['range']

    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type':   contentType,
        'Accept-Ranges':  'bytes',
      })
      res.end()
      return
    }

    if (rangeHeader) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      const start = match && match[1] ? parseInt(match[1], 10) : 0
      const requestedEnd = match && match[2] ? parseInt(match[2], 10) : fileSize - 1
      const clampedEnd = Math.min(requestedEnd, fileSize - 1)

      if (!Number.isFinite(start) || start > clampedEnd || start >= fileSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` })
        res.end()
        return
      }

      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${clampedEnd}/${fileSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': clampedEnd - start + 1,
        'Content-Type':   contentType,
      })
      pipeFileStream(createReadStream(filePath, { start, end: clampedEnd }), req, res)
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type':   contentType,
        'Accept-Ranges':  'bytes',
      })
      pipeFileStream(createReadStream(filePath), req, res)
    }
  } catch (err) {
    log.error('[MediaServer] Error:', err)
    if (!res.headersSent) {
      res.writeHead(500)
      res.end('Internal server error')
    } else if (!res.writableEnded) {
      res.end()
    }
  }
}

function startMediaStreamingServer(): void {
  if (mediaServer) return

  const devUrl = VITE_DEV_SERVER_URL ? VITE_DEV_SERVER_URL.replace(/\/$/, '') : null
  const appOrigin = devUrl || 'file://'

  const server = http.createServer((req, res) => {
    void handleMediaRequest(req, res, appOrigin)
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
        // A failed listen never opened a handle, so calling close() here would
        // itself emit ERR_SERVER_NOT_RUNNING and mask the retry.
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
    log.info(`[MediaServer] Streaming server ready at http://127.0.0.1:${MEDIA_SERVER_PORT} (token-protected)`)
  })

  tryListen(MEDIA_SERVER_PORT)
}

function stopMediaStreamingServer(): void {
  const server = mediaServer
  if (!server) return
  mediaServer = null
  try {
    server.closeAllConnections?.()
    server.close()
    log.info('[MediaServer] Streaming server stopped')
  } catch (err) {
    log.warn('[MediaServer] Failed to stop cleanly:', err)
  }
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

  app.on('before-quit', async () => {
    isQuitting = true
    stopMediaStreamingServer()
    // Kill all active child processes (yt-dlp, ffmpeg) before the app exits.
    // pauseAll() calls killProcessTree for each running process.
    if (downloads && downloads.getActiveCount() > 0) {
      log.info(`[Shutdown] Pausing ${downloads.getActiveCount()} active downloads before quit...`)
      await downloads.pauseAll()
    }
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
    getMediaToken: () => MEDIA_SERVER_TOKEN,
    serviceReadyPromise
  })

  app.whenReady().then(async () => {
    startMediaStreamingServer()
    createWindow()
    initTray()

    try {
      if (win) {
        await runSetup(win)
      }
    } catch (err) {
      log.error('[Backend] Setup failed:', err)
      // We might want to still attempt loading if it failed, or halt.
      // We'll proceed so the app doesn't just hang, but downloads will fail later.
    }

    setTimeout(() => {
      loadBackendServices().catch((err) => {
        log.error('[Backend] loadBackendServices failed — downloads will not work:', err)
        serviceReadyResolve()
      })
    }, 100)
  })
}
