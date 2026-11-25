// Token-protected loopback HTTP media server supporting byte-range streaming and embedded subtitle extraction
import { app } from 'electron'
import log from 'electron-log'
import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, promises as fsPromises } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { db } from './db'
import { type DownloadManager } from './downloadManager'
import { engineExecutionFailed, ensureEnginesReady } from './engines/engineManager'
import { isLibraryMediaPath } from './ipc/mediaLibraryIpc'
import { getBinaryPath } from './paths'
import { MediaRequestRegistry, parseMediaRange } from './services/mediaService'

const MEDIA_SERVER_PORT_BASE = Number(process.env.MEDIA_SERVER_PORT) || 3345
const MEDIA_SERVER_PORT_MAX_TRIES = 10
const MEDIA_ROOTS_TTL_MS = 5_000
const SUBTITLE_EXTRACT_TIMEOUT_MS = 30_000

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.wma': 'audio/x-ms-wma',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.vtt': 'text/vtt',
  '.srt': 'text/plain',
}

function isUnderRoot(target: string, root: string): boolean {
  const rel = path.relative(root, target)
  if (!rel) return false
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

// Reject DNS-rebinding Host headers and cross-origin browser requests to the local media server.
function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  const withoutPort = hostHeader.replace(/:\d+$/, '').toLowerCase()
  return withoutPort === '127.0.0.1' || withoutPort === 'localhost' || withoutPort === '[::1]'
}

function isAllowedOrigin(origin: string | undefined, appOrigin: string): boolean {
  if (!origin || origin === 'null') return true
  return origin === appOrigin
}

export interface MediaStreamingServerOptions {
  getDownloads: () => DownloadManager | null
  isQuitting: () => boolean
  devServerUrl?: string
  onListening?: (port: number) => void
}

export interface MediaStreamingServer {
  token: string
  requests: MediaRequestRegistry
  readyPromise: Promise<void>
  getPort: () => number
  isRunning: () => boolean
  start: () => void
  stop: () => Promise<void>
}

export function createMediaStreamingServer(
  options: MediaStreamingServerOptions,
): MediaStreamingServer {
  const token = randomBytes(32).toString('hex')
  const tokenBuffer = Buffer.from(token, 'utf8')
  const requests = new MediaRequestRegistry()

  let port = MEDIA_SERVER_PORT_BASE
  let server: http.Server | null = null
  let settingsValueStmt: ReturnType<typeof db.prepare> | null = null
  let mediaRootsCache: { roots: string[]; builtAtMs: number } | null = null

  let readyResolve!: () => void
  let readyReject!: (error: unknown) => void
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  void readyPromise.catch(error => log.error('[MediaServer unavailable]', error))

  // Constant-time check for the per-launch loopback capability token.
  const isValidMediaToken = (candidate: string | null): boolean => {
    if (!candidate) return false
    const provided = Buffer.from(candidate, 'utf8')
    if (provided.length !== tokenBuffer.length) return false
    return timingSafeEqual(provided, tokenBuffer)
  }

  const readSettingValue = (key: string): string | null => {
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

  const buildMediaRoots = async (): Promise<string[]> => {
    const candidates = new Set<string>()
    candidates.add(app.getPath('downloads'))
    candidates.add(path.join(os.tmpdir(), 'cortexdl-thumbs'))

    const configuredDir = readSettingValue('downloadDirectory')
    if (configuredDir) candidates.add(configuredDir)

    const tasks = options.getDownloads()?.list() ?? []
    for (const task of tasks) {
      if (task.directory) candidates.add(task.directory)
    }

    // macOS os.tmpdir() can be a symlink; resolve roots before comparing paths.
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

  const getMediaRoots = async (forceRebuild: boolean): Promise<string[]> => {
    const now = Date.now()
    if (!forceRebuild && mediaRootsCache && now - mediaRootsCache.builtAtMs < MEDIA_ROOTS_TTL_MS) {
      return mediaRootsCache.roots
    }
    const roots = await buildMediaRoots()
    mediaRootsCache = { roots, builtAtMs: now }
    return roots
  }

  const isServablePath = async (target: string): Promise<boolean> => {
    const resolved = path.resolve(target)
    const cachedRoots = await getMediaRoots(false)
    if (cachedRoots.some(root => isUnderRoot(resolved, root))) return true

    const freshRoots = await getMediaRoots(true)
    return freshRoots.some(root => isUnderRoot(resolved, root))
  }

  const streamEmbeddedSubtitle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string,
    rawStreamIndex: string | null,
    corsOrigin: string,
    playerSession: string | null,
  ): Promise<void> => {
    await ensureEnginesReady(['ffmpeg'])

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

    const child = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        filePath,
        '-map',
        `0:${streamIndex}`,
        '-c:s',
        'webvtt',
        '-f',
        'webvtt',
        'pipe:1',
      ],
      { windowsHide: true },
    )

    let finished = false
    let untrack = () => {}

    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      res.off('close', finish)
      req.off('aborted', finish)
      child.kill('SIGKILL')
      if (!res.writableEnded) res.end()
    }

    const timer = setTimeout(() => {
      log.warn(`[MediaServer] Subtitle extraction timed out for stream ${streamIndex}`)
      finish()
    }, SUBTITLE_EXTRACT_TIMEOUT_MS)

    // Drain stderr to keep FFmpeg from blocking on a full pipe.
    let stderrTail = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-8192)
    })

    child.stdout.pipe(res)

    child.on('error', err => {
      engineExecutionFailed('ffmpeg', err)
      log.error('[MediaServer] FFmpeg subtitle extraction error:', err)
      finish()
    })

    child.on('close', code => {
      if (code !== 0 && stderrTail.trim()) {
        log.warn(
          `[MediaServer] FFmpeg subtitle exit ${code}${options.devServerUrl ? `: ${stderrTail.trim()}` : ''}`,
        )
      }
      finished = true
      clearTimeout(timer)
      untrack()
      res.off('close', finish)
      req.off('aborted', finish)
      if (!res.writableEnded) res.end()
    })

    res.on('close', finish)
    req.on('aborted', finish)
    untrack = requests.track(playerSession, 'subtitle', finish)
  }

  const pipeFileStream = (
    stream: ReturnType<typeof createReadStream>,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    playerSession: string | null,
  ): void => {
    let finished = false
    let untrack = () => {}
    const destroy = () => {
      if (finished) return
      finished = true
      res.off('close', destroy)
      req.off('aborted', destroy)
      if (!stream.destroyed) stream.destroy()
      if (!res.writableEnded) res.destroy()
    }
    res.on('close', destroy)
    req.on('aborted', destroy)
    stream.on('close', () => {
      untrack()
      destroy()
    })
    stream.on('error', err => {
      log.error(
        '[MediaServer] Read stream error:',
        (err as NodeJS.ErrnoException).code ?? 'unknown',
      )
      destroy()
      if (!res.writableEnded) res.end()
    })

    untrack = requests.track(playerSession, 'stream', destroy)
    if (!finished) stream.pipe(res)
  }

  const handleMediaRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    appOrigin: string,
  ): Promise<void> => {
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
        res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' })
        res.end('Method not allowed')
        return
      }

      const urlObj = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

      if (!isValidMediaToken(urlObj.searchParams.get('token'))) {
        log.warn('[MediaServer] Rejected a request that carried no valid capability token')
        res.writeHead(401)
        res.end('Unauthorized')
        return
      }

      if (urlObj.pathname === '/health') {
        res.writeHead(204)
        res.end()
        return
      }

      const playerSession = urlObj.searchParams.get('session')
      if (
        (playerSession && !/^[a-zA-Z0-9-]{1,80}$/.test(playerSession)) ||
        requests.isClosed(playerSession)
      ) {
        res.writeHead(410)
        res.end('Media session closed')
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

      let filePath: string
      try {
        filePath = await fsPromises.realpath(requestedPath)
      } catch {
        res.writeHead(404)
        res.end('File not found')
        return
      }

      if (
        !(await isServablePath(filePath)) &&
        !(await isLibraryMediaPath(requestedPath, filePath))
      ) {
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
        await streamEmbeddedSubtitle(
          req,
          res,
          filePath,
          urlObj.searchParams.get('streamIndex'),
          corsOrigin,
          playerSession,
        )
        return
      }

      const fileSize = stat.size
      const rangeHeader = req.headers['range']

      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        })
        res.end()
        return
      }

      if (rangeHeader) {
        const range = parseMediaRange(rangeHeader, fileSize)
        if (!range) {
          res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` })
          res.end()
          return
        }
        const [start, clampedEnd] = range
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': clampedEnd - start + 1,
          'Content-Type': contentType,
        })
        pipeFileStream(
          createReadStream(filePath, { start, end: clampedEnd }),
          req,
          res,
          playerSession,
        )
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        })
        pipeFileStream(createReadStream(filePath), req, res, playerSession)
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

  const start = (): void => {
    if (server) return

    const devUrl = options.devServerUrl ? options.devServerUrl.replace(/\/$/, '') : null
    const appOrigin = devUrl || 'file://'

    const httpServer = http.createServer((req, res) => {
      void handleMediaRequest(req, res, appOrigin)
    })
    server = httpServer
    httpServer.keepAliveTimeout = 5000

    let attempt = 0

    const tryListen = (candidatePort: number) => {
      port = candidatePort
      try {
        httpServer.listen(candidatePort, '127.0.0.1')
      } catch (error) {
        server = null
        readyReject(error)
      }
    }

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (options.isQuitting()) return
      if (err.code === 'EADDRINUSE') {
        attempt++
        const nextPort = MEDIA_SERVER_PORT_BASE + attempt
        if (attempt < MEDIA_SERVER_PORT_MAX_TRIES) {
          log.warn(`[MediaServer] Port ${port} in use, trying ${nextPort}…`)
          // Failed listen creates no handle; close() would mask EADDRINUSE.
          tryListen(nextPort)
        } else if (attempt === MEDIA_SERVER_PORT_MAX_TRIES) {
          tryListen(0)
        } else {
          log.error(
            `[MediaServer] All ports ${MEDIA_SERVER_PORT_BASE}–${nextPort} are in use. Media server could not start.`,
          )
          server = null
          readyReject(err)
        }
      } else {
        log.error('[MediaServer] Server error:', err)
        server = null
        readyReject(err)
      }
    })

    httpServer.on('listening', () => {
      if (options.isQuitting()) {
        httpServer.close()
        return
      }
      port = (httpServer.address() as AddressInfo).port
      server = httpServer
      options.onListening?.(port)
      readyResolve()
      log.info(`[MediaServer] Streaming server ready at http://127.0.0.1:${port} (token-protected)`)
    })

    tryListen(port)
  }

  const stop = async (): Promise<void> => {
    await requests.closeAll()
    const current = server
    if (!current) return
    server = null
    await new Promise<void>(resolve => {
      try {
        current.close(err => {
          if (err) log.warn('[MediaServer] Failed to stop cleanly:', err)
          resolve()
        })
        current.closeAllConnections?.()
        current.closeIdleConnections?.()
      } catch (err) {
        log.warn('[MediaServer] Failed to stop cleanly:', err)
        resolve()
      }
    })
    log.info('[MediaServer] Streaming server stopped')
  }

  return {
    token,
    requests,
    readyPromise,
    getPort: () => port,
    isRunning: () => Boolean(server),
    start,
    stop,
  }
}
