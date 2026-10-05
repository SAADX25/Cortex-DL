import { spawn, spawnSync } from 'node:child_process'
import type { AnalyzeResult, CookieValidationResult, JsRuntimeStatus, SubtitleTrack } from './types'
import log from 'electron-log'
import path from 'node:path'
import { chmodSync, createWriteStream, existsSync } from 'node:fs'
import { get } from 'node:https'
import { unlink, rename, stat } from 'node:fs/promises'
import { getBinaryPath, getBinDirectory } from './paths'
import { db } from './db'
import { ytdlpCacheArgs } from './ytdlpCache'
import { analysisTiming } from './analysisTiming'
import { CookieValidationCache } from './cookieValidation'
import { AnalysisCoordinator } from './analysisCoordinator'
import { extractAnalysis } from './analysisProcess'
import { fetchBoundedJson } from './analysisNetwork'
import { extractPreview, PREVIEW_FORMAT, type PreviewExtractionOptions } from './previewExtraction'

const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000
const ANALYSIS_CACHE_MAX = 50
const MIN_DENO_VERSION: VersionTuple = [2, 3, 0]
const MIN_NODE_VERSION: VersionTuple = [18, 0, 0]
const MIN_BUN_VERSION: VersionTuple = [1, 2, 11]
const MAX_BUN_VERSION: VersionTuple = [1, 3, 14]
export const YOUTUBE_EXTRACTOR_ARGS = ''
export const YOUTUBE_AUTH_REQUIRED_CODE = 'YOUTUBE_AUTH_REQUIRED'

const YOUTUBE_AUTH_ERROR_PATTERNS = [
  /sign in to confirm/i,
  /not a bot/i,
  /use --cookies-from-browser or --cookies/i,
  /login_required/i,
  /age[- ]restricted/i,
  /http error 429/i,
  /too many requests/i,
  /rate[-_\s]?limit(?:ed|ing)?/i,
  /request(?:s)?[^\r\n]{0,40}limit exceeded/i,
  /temporarily blocked[^\r\n]{0,40}(?:request|traffic|youtube)/i,
]

function getErrorText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    const cause = 'cause' in value ? getErrorText(value.cause) : ''
    return [value.name, value.message, value.stack, cause].filter(Boolean).join('\n')
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return ['code', 'message', 'stderr', 'stdout']
      .map((key) => record[key])
      .filter((item): item is string => typeof item === 'string')
      .join('\n')
  }
  return String(value ?? '')
}

export function isYouTubeAuthRequiredError(value: unknown): boolean {
  const text = getErrorText(value)
  return text.includes(YOUTUBE_AUTH_REQUIRED_CODE)
    || YOUTUBE_AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

export class YouTubeAuthRequiredError extends Error {
  readonly code = YOUTUBE_AUTH_REQUIRED_CODE

  constructor() {
    super(
      `${YOUTUBE_AUTH_REQUIRED_CODE}: YouTube requires sign-in, CAPTCHA verification, or has rate-limited this request. ` +
      'Select a valid YouTube cookies.txt file in Settings and try again.',
    )
    this.name = 'YouTubeAuthRequiredError'
  }
}

type VersionTuple = [number, number, number]

type JsRuntimeCandidate = {
  label: string
  spec: string
  command: string
  minVersion: VersionTuple
  maxVersion?: VersionTuple
  env?: NodeJS.ProcessEnv
}

type JsRuntimeSelection = {
  args: string[]
  available: boolean
  name: string
}

const analysisCoordinator = new AnalysisCoordinator<AnalyzeResult>(3, ANALYSIS_CACHE_TTL_MS, ANALYSIS_CACHE_MAX, Date.now, result => result.kind !== 'unknown', result => {
  if (result.kind === 'ytdlp') result.formats = result.formats.map(({ url: _url, ...format }) => format)
  return result
})
let cachedJsRuntimeSelection: JsRuntimeSelection | null = null
let warnedNoSupportedRuntime = false

function parseVersion(text: string): VersionTuple | null {
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(text)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(a: VersionTuple, b: VersionTuple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

function formatVersion(version: VersionTuple): string {
  return version.join('.')
}

function getExistingBinaryPath(name: string): string | null {
  const binaryPath = getBinaryPath(name)
  return existsSync(binaryPath) ? binaryPath : null
}

function getRuntimeVersion(candidate: JsRuntimeCandidate): VersionTuple | null {
  // Fast-path: Electron Node is already running in memory — 0ms check!
  if (candidate.command === process.execPath) {
    return parseVersion(process.versions.node)
  }

  // If command is a file path, verify existence before calling spawnSync
  if (candidate.command.includes('/') || candidate.command.includes('\\')) {
    if (!existsSync(candidate.command)) return null
  }

  try {
    const result = spawnSync(candidate.command, ['--version'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 800,
      env: candidate.env ?? process.env,
    })
    if (result.error) return null
    return parseVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  } catch {
    return null
  }
}

function trySelectRuntime(candidate: JsRuntimeCandidate): JsRuntimeSelection | null {
  const version = getRuntimeVersion(candidate)
  if (!version) return null
  if (compareVersions(version, candidate.minVersion) < 0) return null
  if (candidate.maxVersion && compareVersions(version, candidate.maxVersion) > 0) return null

  return {
    args: ['--js-runtimes', candidate.spec],
    available: true,
    name: `${candidate.label} ${formatVersion(version)}`,
  }
}

function selectJsRuntime(): JsRuntimeSelection {
  if (cachedJsRuntimeSelection) return cachedJsRuntimeSelection

  const electronNodeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  const candidates: JsRuntimeCandidate[] = []
  const bundledDeno = getExistingBinaryPath('deno')
  const bundledNode = getExistingBinaryPath('node')
  const bundledBun = getExistingBinaryPath('bun')

  // 1. Electron Node (Built-in, 0ms execution, always present, Node >= 22)
  candidates.push({
    label: 'Electron Node',
    spec: `node:${process.execPath}`,
    command: process.execPath,
    minVersion: MIN_NODE_VERSION,
    env: electronNodeEnv,
  })

  // 2. Bundled runtimes (if present on disk)
  if (bundledDeno) {
    candidates.push({ label: 'Deno', spec: `deno:${bundledDeno}`, command: bundledDeno, minVersion: MIN_DENO_VERSION })
  }
  if (bundledNode) {
    candidates.push({ label: 'Node', spec: `node:${bundledNode}`, command: bundledNode, minVersion: MIN_NODE_VERSION })
  }
  if (bundledBun) {
    candidates.push({
      label: 'Bun',
      spec: `bun:${bundledBun}`,
      command: bundledBun,
      minVersion: MIN_BUN_VERSION,
      maxVersion: MAX_BUN_VERSION,
    })
  }

  for (const candidate of candidates) {
    const selected = trySelectRuntime(candidate)
    if (selected) {
      cachedJsRuntimeSelection = selected
      log.info(`[ytdlp] Using JS runtime: ${selected.name}`)
      return selected
    }
  }

  cachedJsRuntimeSelection = {
    args: [],
    available: false,
    name: 'None',
  }

  if (!warnedNoSupportedRuntime) {
    warnedNoSupportedRuntime = true
    log.warn('[ytdlp] No supported JS runtime found. yt-dlp 2026.06.09 requires Deno >= 2.3.0 or Node >= 22; Bun support is limited to 1.2.11 through 1.3.14.')
  }

  return cachedJsRuntimeSelection
}

const cookieArgsCache = new CookieValidationCache()

export async function validateCookieFile(filePath: string | null | undefined): Promise<CookieValidationResult> {
  if (!filePath) return { valid: false, code: 'missing', message: 'No cookies file is configured.', filePath: null }
  return cookieArgsCache.validate(filePath)
}

export async function getYtdlpCookieArgs(): Promise<string[]> {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('cookieFilePath') as { value: string } | undefined
    if (!row?.value) return []

    const validation = await cookieArgsCache.validate(row.value)
    if (!validation.valid || !validation.filePath) {
      log.warn(`[ytdlp] Ignoring invalid cookie file (${validation.code}): ${validation.filePath ?? 'none'}`)
      return []
    }

    return ['--cookies', validation.filePath]
  } catch (err) {
    log.warn('[ytdlp] Failed to read cookie file setting:', err)
    return []
  }
}

export async function isYtdlpAvailable(): Promise<boolean> {
  try {
    const p = spawn(getBinaryPath('yt-dlp'), ['--version'], { windowsHide: true, detached: false })
    const exitCode: number = await new Promise((resolve) => {
      p.on('close', (code) => resolve(code ?? 1))
      p.on('error', () => resolve(1))
    })
    return exitCode === 0
  } catch {
    return false
  }
}

export async function getYtdlpVersion(): Promise<string> {
  const TIMEOUT_MS = 5000

  try {
    const binaryPath = getBinaryPath('yt-dlp')
    log.info(`[ytdlp] Checking version at: ${binaryPath}`)

    if (!existsSync(binaryPath)) {
      log.info('[ytdlp] Binary not found')
      return 'Not Installed'
    }

    const p = spawn(binaryPath, ['--version'], {
      windowsHide: true,
      detached: false,
      timeout: TIMEOUT_MS
    })

    let stdout = ''
    p.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    const exitCode: number = await Promise.race([
      new Promise<number>((resolve) => {
        p.on('close', (code) => resolve(code ?? 1))
        p.on('error', () => resolve(1))
      }),
      new Promise<number>((resolve) => {
        setTimeout(() => {
          try { p.kill() } catch {
            // The timed-out process may have exited already.
          }
          resolve(1)
        }, TIMEOUT_MS)
      })
    ])

    if (exitCode === 0 && stdout.trim()) {
      return stdout.trim()
    }
    return 'Unknown'
  } catch (err) {
    log.error('[ytdlp] Version check error:', err)
    return 'Error'
  }
}

function fetchJson(url: string): Promise<any> {
  return fetchBoundedJson(url, undefined, 8000)
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Cortex-DL-App'
      }
    }

    const handleResponse = (response: any) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        if (response.headers.location) {
          get(response.headers.location, options as any, handleResponse).on('error', reject)
        } else {
          reject(new Error('Redirect without location'))
        }
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      const file = createWriteStream(destPath)

      const totalSize = parseInt(response.headers['content-length'] || '0', 10)
      let downloaded = 0
      let lastLogTime = Date.now()

      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        const now = Date.now()
        if (now - lastLogTime > 2000) {
          const percent = totalSize ? ((downloaded / totalSize) * 100).toFixed(1) : '?'
          const mb = (downloaded / (1024 * 1024)).toFixed(2)
          log.info(`[ytdlp updater] Download progress: ${mb}MB (${percent}%)`)
          lastLogTime = now
        }
      })

      response.pipe(file)

      file.on('finish', () => {
        log.info(`[ytdlp updater] Finished downloading to ${destPath}`)
        file.close()
        resolve()
      })
      file.on('error', (err: Error) => {
        log.error(`[ytdlp updater] Failed to write download:`, err)
        file.close()
        reject(err)
      })
    }

    get(url, options as any, handleResponse).on('error', reject)
  })
}

export async function updateYtdlp(): Promise<{ success: boolean; message: string; version?: string }> {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Auto-update is only available on Windows.' }
  }

  const binDir = getBinDirectory()
  const binaryPath = path.join(binDir, 'yt-dlp.exe')
  const tempPath = path.join(binDir, 'yt-dlp_new.exe')
  const oldPath = binaryPath + '.old'


  try {
    if (existsSync(oldPath)) {
      await unlink(oldPath)
      log.info(`[ytdlp] Cleaned up old binary: ${oldPath}`)
    }
  } catch (cleanupErr) {
    log.warn(`[ytdlp] Failed to clean up old binary: ${oldPath}`, cleanupErr)
  }

  log.info(`[ytdlp] Update: binDir=${binDir}, binaryPath=${binaryPath}`)

  try {

    log.info('[ytdlp] Fetching latest release from GitHub...')
    const releaseUrl = process.env.GITHUB_RELEASE_API || 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
    const releaseData = await fetchJson(releaseUrl)

    const latestVersion = releaseData.tag_name || releaseData.name
    log.info(`[ytdlp] Latest version: ${latestVersion}`)


    const asset = releaseData.assets?.find((a: any) =>
      a.name === 'yt-dlp.exe' || a.name === 'yt-dlp_win.exe'
    )

    if (!asset || !asset.browser_download_url) {
      return { success: false, message: 'Could not find Windows executable in release.' }
    }

    const downloadUrl = asset.browser_download_url
    log.info(`[ytdlp] Download URL: ${downloadUrl}`)


    log.info('[ytdlp] Downloading new binary...')
    await downloadFile(downloadUrl, tempPath)


    if (!existsSync(tempPath)) {
      return { success: false, message: 'Download failed - temp file not created.' }
    }

const stats = await stat(tempPath)
    if (stats.size < 1000000) {
      await unlink(tempPath).catch(() => {})
      return { success: false, message: 'Download appears corrupted (file too small).' }
    }


    log.info('[ytdlp] Replacing old binary...')
    if (existsSync(binaryPath)) {
      try {
        await unlink(binaryPath)
      } catch (err) {

        try {
          await rename(binaryPath, binaryPath + '.old')
        } catch (renameErr) {
          log.error('======================================================')
          log.error('[yt-dlp UPDATER FATAL ERROR]')
          log.error('Failed to replace the old binary! It is likely locked.')
          log.error('Unlink Error:', err)
          log.error('Rename Error:', renameErr)
          log.error('Binary Path:', binaryPath)
          log.error('======================================================')
          await unlink(tempPath).catch(() => {})
          return { success: false, message: 'Failed to remove old binary. Make sure no downloads are active.' }
        }
      }
    }


    try {
      await rename(tempPath, binaryPath)
    } catch (renameFinalErr) {
      log.error('======================================================')
      log.error('[yt-dlp UPDATER FATAL ERROR]')
      log.error('Failed to rename the new temp binary to the final path!')
      log.error('Rename Error:', renameFinalErr)
      log.error('From:', tempPath, 'To:', binaryPath)
      log.error('======================================================')
      return { success: false, message: 'Failed to rename new binary.' }
    }


    try {
      chmodSync(binaryPath, 0o755)
    } catch {
      // chmod is best effort on platforms without POSIX permissions.
    }

    log.info(`[ytdlp] Update successful! Version: ${latestVersion}`)
    return { success: true, message: `Updated successfully to ${latestVersion}!`, version: latestVersion }

  } catch (err) {
    log.error('[ytdlp] Update error:', err)

    if (existsSync(tempPath)) {
      await unlink(tempPath).catch(() => {})
    }
    return { success: false, message: `Update failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
  }
}

export async function checkJsRuntime(): Promise<JsRuntimeStatus> {
  const selected = selectJsRuntime()
  return { available: selected.available, name: selected.name }
}

function isYouTubeUrl(url: string): boolean {
  const low = url.toLowerCase()
  return low.includes('youtube.com') || low.includes('youtu.be')
}

export function getJsRuntimeArgs(): string[] {
  return selectJsRuntime().args
}

export async function analyzeWithYtdlp(url: string, signal?: AbortSignal): Promise<AnalyzeResult> {
  signal?.throwIfAborted()
  const cookies = await getYtdlpCookieArgs()
  const scope = cookies[1] ? cookieArgsCache.fingerprint(cookies[1]) : 'public'
  return analysisCoordinator.run(url, (normalized, owned) => extractFullAnalysis(normalized, owned, cookies), signal, scope)
}

async function extractFullAnalysis(url: string, signal: AbortSignal, cookies: string[]): Promise<AnalyzeResult> {
  const ytdlpPath = getBinaryPath('yt-dlp')
  if (!existsSync(ytdlpPath)) throw new Error('yt-dlp binary not found in the bin directory')
  const isPlaylist = url.toLowerCase().includes('list=') || url.toLowerCase().includes('/playlist')

  const args = [
    '--dump-single-json',
    ...ytdlpCacheArgs(),
    isPlaylist ? '--yes-playlist' : '--no-playlist',
    '--geo-bypass',
    '--no-warnings',
    '--ignore-errors',
    '--socket-timeout', '10',
    ...(YOUTUBE_EXTRACTOR_ARGS ? ['--extractor-args', YOUTUBE_EXTRACTOR_ARGS] : []),
    ...cookies,
  ]

  if (isPlaylist) {
    args.push('--flat-playlist')
  }

  args.push(...getJsRuntimeArgs())

  args.push(url)

  const startMs = Date.now()
  log.info('[ytdlp] Analysis started')
  let stdout: string
  try {
    stdout = await extractAnalysis(ytdlpPath, args, signal)
  } catch (error) {
    if (isYouTubeUrl(url) && isYouTubeAuthRequiredError(error)) throw new YouTubeAuthRequiredError()
    if (!signal.aborted && /Unsupported URL|no suitable extractor/i.test(getErrorText(error))) return { kind: 'unknown' }
    throw error
  } finally {
    log.info(`[ytdlp] Analysis extraction finished in ${Date.now() - startMs}ms`)
  }
  const parseStart = Date.now()
  const info = JSON.parse(stdout)
  analysisTiming('jsonParseMs', parseStart)


  if (info._type === 'playlist') {
    const items = (info.entries || []).map((entry: any) => {
        let extractedThumbnail = entry.thumbnail;
        if (!extractedThumbnail && entry.thumbnails && entry.thumbnails.length > 0) {
            extractedThumbnail = entry.thumbnails[entry.thumbnails.length - 1].url;
        }

        let entryUrl = entry.url || entry.webpage_url;

        if (!entryUrl && entry.id) {
          entryUrl = `https://www.youtube.com/watch?v=${entry.id}`
        } else if (entryUrl && !entryUrl.startsWith('http')) {

          entryUrl = `https://www.youtube.com/watch?v=${entryUrl}`
        }

        return {
            id: entry.id,
            title: entry.title || 'Unknown Title',
            url: entryUrl,
            thumbnail: extractedThumbnail ? String(extractedThumbnail) : undefined
        };
    }).filter((i: any) => !!i.url)

    const result: AnalyzeResult = {
      kind: 'playlist',
      title: info.title || 'Playlist',
      items
    }
    return result
  }

  const formats = (info.formats || [])
    .filter((f: any) => f.vcodec !== 'none' || f.acodec !== 'none')
    .map((f: any) => ({
      formatId: f.format_id,
      ext: f.ext,
      vcodec: f.vcodec,
      acodec: f.acodec,
      resolution: f.resolution || (f.vcodec !== 'none' ? `${f.width}x${f.height}` : 'audio only'),
      filesize: f.filesize || f.filesize_approx || null,
      description: `${f.format_note || ''} ${f.fps ? f.fps + 'fps' : ''} ${f.tbr ? Math.round(f.tbr) + 'kbps' : ''} ${f.vcodec !== 'none' && f.acodec !== 'none' ? '(Muxed)' : ''}`.trim(),
      url: typeof f.url === 'string' ? f.url : undefined,
      tbr: f.tbr || 0,
      height: f.height || 0,
      fps: f.fps || 0
    }))

    .sort((a: any, b: any) => b.height - a.height || b.tbr - a.tbr)

  let extractedThumbnail = info.thumbnail;
  if (!extractedThumbnail && info.thumbnails && info.thumbnails.length > 0) {
      extractedThumbnail = info.thumbnails[info.thumbnails.length - 1].url;
  }

  const subtitleTracks = new Map<string, SubtitleTrack>()
  const addSubtitleTracks = (tracks: unknown, isAutomatic: boolean) => {
    if (!tracks || typeof tracks !== 'object') return

    for (const [languageCode, formats] of Object.entries(tracks)) {
      if (!languageCode || !Array.isArray(formats) || formats.length === 0) continue
      if (subtitleTracks.has(languageCode)) continue

      const namedFormat = formats.find((format: any) => typeof format?.name === 'string' && format.name.trim())
      subtitleTracks.set(languageCode, {
        languageCode,
        name: namedFormat?.name?.trim() || languageCode,
        isAutomatic,
      })
    }
  }



  addSubtitleTracks(info.subtitles, false)
  addSubtitleTracks(info.automatic_captions, true)

  const subtitles = Array.from(subtitleTracks.values()).sort((a, b) => {
    if (a.isAutomatic !== b.isAutomatic) return a.isAutomatic ? 1 : -1
    return a.name.localeCompare(b.name)
  })


  const result: AnalyzeResult = {
    kind: 'ytdlp',
    title: info.title || 'Unknown Title',
    thumbnail: extractedThumbnail ? String(extractedThumbnail) : undefined,
    formats,
    views: info.view_count,
    likes: info.like_count,
    dislikes: info.dislike_count,
    duration: info.duration,
    subtitles
  };

  analysisTiming('fullMetadataMs', startMs)
  return result

}


export async function getDirectStreamUrl(url: string, options: PreviewExtractionOptions = {}): Promise<string> {
  const binary = getBinaryPath('yt-dlp')
  if (!existsSync(binary)) throw new Error('yt-dlp binary not found in the bin directory')
  try {
    return await extractPreview(binary, [
      '-f', PREVIEW_FORMAT, '--dump-single-json', '--no-playlist', '--geo-bypass', ...ytdlpCacheArgs(),
      '--force-ipv4', '--socket-timeout', '10',
      ...(YOUTUBE_EXTRACTOR_ARGS ? ['--extractor-args', YOUTUBE_EXTRACTOR_ARGS] : []),
      ...await getYtdlpCookieArgs(), ...getJsRuntimeArgs(), url,
    ], options)
  } catch (error) {
    log.error('[ytdlp] Preview extraction failed:', error)
    if (isYouTubeUrl(url) && isYouTubeAuthRequiredError(error)) throw new YouTubeAuthRequiredError()
    throw error
  }
}
