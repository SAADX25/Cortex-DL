// Application health check probe verifying engines, SQLite DB, media server, update endpoint, and folder write access
import { app } from 'electron'
import log from 'electron-log'
import { promises as fsPromises } from 'node:fs'
import path from 'node:path'
import { db } from '../db'
import { buildInfo } from '../diagnostics'
import { engineHealth } from '../engines/engineManager'
import { checkJsRuntime, getYtdlpVersion } from '../engines/ytdlpService'
import { getBinaryPath } from '../paths'
import { fetchBoundedJson } from '../services/analysisService'
import type { AppHealthCheck } from '../types'

// Probe write permission via an exclusive temp file instead of fs.access (unreliable on Windows ACLs)
async function isDirectoryWritable(directory: string): Promise<boolean> {
  const testPath = path.join(directory, `.cortex-dl-write-test-${process.pid}-${Date.now()}`)
  let handle: Awaited<ReturnType<typeof fsPromises.open>> | null = null

  try {
    handle = await fsPromises.open(testPath, 'wx')
    return true
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => {})
    await fsPromises.unlink(testPath).catch(() => {})
  }
}

export async function getAppHealthCheck(
  mediaPort: number,
  mediaToken: string,
  uiReady?: Promise<unknown>,
): Promise<AppHealthCheck> {
  let downloadDirectory = app.getPath('downloads')

  try {
    const directoryRow = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('downloadDirectory') as { value: string } | undefined
    downloadDirectory = directoryRow?.value || downloadDirectory
  } catch (err) {
    log.warn('[health] Failed to read persisted settings:', err)
  }

  const engines = await engineHealth()
  const ffmpegPath = getBinaryPath('ffmpeg')
  const [ytDlpVersion, jsRuntime, directoryWritable] = await Promise.all([
    getYtdlpVersion(),
    checkJsRuntime(),
    isDirectoryWritable(downloadDirectory),
  ])
  const ytDlpAvailable = !['Not Installed', 'Unknown', 'Error'].includes(ytDlpVersion)
  const ffmpegAvailable = engines.find(engine => engine.name === 'ffmpeg')?.available === true
  const probe = engines.find(engine => engine.name === 'ffprobe')!
  const database = db.pragma('quick_check', { simple: true }) === 'ok'
  const mediaServer = await fetch(
    `http://127.0.0.1:${mediaPort}/health?token=${encodeURIComponent(mediaToken)}`,
    { method: 'HEAD', signal: AbortSignal.timeout(2000) },
  ).then(
    response => response.status === 204,
    () => false,
  )
  await uiReady
  const updateService = await fetchBoundedJson(
    'https://api.github.com/repos/SAADX25/Cortex-DL/releases/latest',
    undefined,
    3000,
  ).then(
    () => 'reachable' as const,
    () => 'unavailable' as const,
  )

  return {
    checkedAt: Date.now(),
    healthy:
      mediaServer &&
      database &&
      probe.available &&
      ytDlpAvailable &&
      ffmpegAvailable &&
      jsRuntime.available &&
      directoryWritable,
    ytDlp: { available: ytDlpAvailable, version: ytDlpVersion },
    ffmpeg: {
      available: ffmpegAvailable,
      path: ffmpegPath,
      version: engines.find(e => e.name === 'ffmpeg')?.version,
    },
    ffprobe: probe,
    database: { healthy: database },
    build: buildInfo(),
    mediaServer: { healthy: mediaServer },
    updateService,
    jsRuntime,
    downloadDirectory: { writable: directoryWritable, path: downloadDirectory },
  }
}
