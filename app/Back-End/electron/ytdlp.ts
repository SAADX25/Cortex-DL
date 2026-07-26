import { spawn, spawnSync } from 'node:child_process'
import type { AnalyzeResult, CookieValidationResult, JsRuntimeStatus, SubtitleTrack } from './types'
import log from 'electron-log'
import path from 'node:path'
import { chmodSync, createWriteStream, existsSync, readFileSync, statSync } from 'node:fs'
import { get } from 'node:https'
import { unlink, rename, stat } from 'node:fs/promises'
import { getBinaryPath, getBinDirectory } from './paths'
import { db } from './db'

const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000 
const ANALYSIS_CACHE_MAX = 50 
const MIN_DENO_VERSION: VersionTuple = [2, 3, 0]
const MIN_NODE_VERSION: VersionTuple = [22, 0, 0]
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

interface CacheEntry {
  result: AnalyzeResult
  timestamp: number
}

const analysisCache = new Map<string, CacheEntry>()
let cachedJsRuntimeSelection: JsRuntimeSelection | null = null
let warnedNoSupportedRuntime = false

function normalizeUrlForCache(url: string): string {
  
  return url.trim().replace(/\/+$/, '')
}

function getCachedAnalysis(url: string): AnalyzeResult | null {
  const key = normalizeUrlForCache(url)
  const entry = analysisCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > ANALYSIS_CACHE_TTL_MS) {
    analysisCache.delete(key)
    return null
  }
  log.info(`[ytdlp] Cache HIT for: ${key.slice(0, 80)}...`)
  return entry.result
}

function setCachedAnalysis(url: string, result: AnalyzeResult): void {
  const key = normalizeUrlForCache(url)
  
  if (analysisCache.size >= ANALYSIS_CACHE_MAX) {
    const oldestKey = analysisCache.keys().next().value
    if (oldestKey) analysisCache.delete(oldestKey)
  }
  analysisCache.set(key, { result, timestamp: Date.now() })
}

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
  try {
    const result = spawnSync(candidate.command, ['--version'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 3000,
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

  if (bundledDeno) {
    candidates.push({ label: 'Deno', spec: `deno:${bundledDeno}`, command: bundledDeno, minVersion: MIN_DENO_VERSION })
  }
  if (bundledNode) {
    candidates.push({ label: 'Node', spec: `node:${bundledNode}`, command: bundledNode, minVersion: MIN_NODE_VERSION })
  }

  candidates.push(
    { label: 'Deno', spec: 'deno', command: 'deno', minVersion: MIN_DENO_VERSION },
    { label: 'Node', spec: 'node', command: 'node', minVersion: MIN_NODE_VERSION },
  )

  if (bundledBun) {
    candidates.push({
      label: 'Bun',
      spec: `bun:${bundledBun}`,
      command: bundledBun,
      minVersion: MIN_BUN_VERSION,
      maxVersion: MAX_BUN_VERSION,
    })
  }

  candidates.push(
    { label: 'Bun', spec: 'bun', command: 'bun', minVersion: MIN_BUN_VERSION, maxVersion: MAX_BUN_VERSION },
    {
      label: 'Electron Node',
      spec: `node:${process.execPath}`,
      command: process.execPath,
      minVersion: MIN_NODE_VERSION,
      env: electronNodeEnv,
    },
  )

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

export function validateCookieFile(filePath: string | null | undefined): CookieValidationResult {
  if (!filePath) {
    return { valid: false, code: 'missing', message: 'No cookies file is configured.', filePath: null }
  }

  const resolvedPath = path.resolve(filePath)
  if (!existsSync(resolvedPath)) {
    return { valid: false, code: 'missing', message: 'The selected cookies file does not exist.', filePath: resolvedPath }
  }

  try {
    if (!statSync(resolvedPath).isFile()) {
      return { valid: false, code: 'not_file', message: 'The selected path is not a file.', filePath: resolvedPath }
    }

    const contents = readFileSync(resolvedPath, 'utf8')
    const firstLine = (contents.split(/\r?\n/, 1)[0] ?? '').replace(/^\uFEFF/, '').trim()
    if (firstLine !== '# Netscape HTTP Cookie File' && firstLine !== '# HTTP Cookie File') {
      return {
        valid: false,
        code: 'invalid_header',
        message: 'The file is not a Netscape cookies.txt export.',
        filePath: resolvedPath,
      }
    }

    if (!/(?:^|\.)youtube\.com/i.test(contents)) {
      return {
        valid: false,
        code: 'missing_youtube',
        message: 'The cookies file does not contain YouTube cookies.',
        filePath: resolvedPath,
      }
    }

    return { valid: true, code: 'valid', message: 'YouTube cookies file is valid.', filePath: resolvedPath }
  } catch (err) {
    log.warn(`[ytdlp] Failed to validate cookie file: ${resolvedPath}`, err)
    return { valid: false, code: 'read_error', message: 'The cookies file could not be read.', filePath: resolvedPath }
  }
}

export function getYtdlpCookieArgs(): string[] {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('cookieFilePath') as { value: string } | undefined
    if (!row?.value) return []

    const validation = validateCookieFile(row.value)
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
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Cortex-DL-App',
        'Accept': 'application/vnd.github.v3+json'
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
      
      let data = ''
      response.on('data', (chunk: string) => { data += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('Invalid JSON'))
        }
      })
    }
    
    get(url, options as any, handleResponse).on('error', reject)
  })
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

export async function analyzeWithYtdlp(url: string): Promise<AnalyzeResult> {
  
  const cached = getCachedAnalysis(url)
  if (cached) return cached

  const ytdlpPath = getBinaryPath('yt-dlp')
  if (!existsSync(ytdlpPath)) {
    throw new Error('ملف yt-dlp.exe غير موجود في مجلد bin. يرجى التأكد من وجوده.')
  }

  return new Promise((resolve, reject) => {
    const isPlaylist = url.toLowerCase().includes('list=') || url.toLowerCase().includes('/playlist')

    const args = [
      '--dump-single-json',
      isPlaylist ? '--yes-playlist' : '--no-playlist',
      '--no-check-certificate',
      '--geo-bypass',
      '--no-warnings',
      '--ignore-errors',
      '--socket-timeout', '10',
      '--no-cache-dir',
      ...(YOUTUBE_EXTRACTOR_ARGS ? ['--extractor-args', YOUTUBE_EXTRACTOR_ARGS] : []),
      ...getYtdlpCookieArgs(),
    ]

    if (isPlaylist) {
      args.push('--flat-playlist')
    }

    args.push(...getJsRuntimeArgs())

    args.push(url)

    const startMs = Date.now()
    log.info(`[ytdlp] Spawning analysis for: ${url.slice(0, 80)}...`)

    const p = spawn(getBinaryPath('yt-dlp'), args, { windowsHide: true, detached: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })

    let stdout = ''
    let stderr = ''

    p.stdout.on('data', (data) => {
      const chunk = data.toString()
      stdout += chunk
      log.info(`[ytdlp stdout] received ${chunk.length} bytes`)
    })
    
    p.stderr.on('data', (data) => {
      const chunk = data.toString()
      stderr += chunk
      log.error(`[ytdlp stderr] ${chunk.trim()}`)
    })

    
    p.on('error', (err) => {
      reject(new Error(`فشل تشغيل yt-dlp: ${err.message}`))
    })

    p.on('close', async (code) => {
      const elapsedMs = Date.now() - startMs
      log.info(`[ytdlp] Analysis finished in ${elapsedMs}ms (exit ${code})`)

      if (code !== 0) {
        log.error('yt-dlp analysis failed:', stderr)
        if (isYouTubeUrl(url) && isYouTubeAuthRequiredError(stderr)) {
          reject(new YouTubeAuthRequiredError())
          return
        }
        resolve({ kind: 'unknown' })
        return
      }

      try {
        const info = JSON.parse(stdout)
        log.info(`[ytdlp Debug] Info parsed. Views: ${info.view_count}, Likes: ${info.like_count}, Comments: ${info.comments ? info.comments.length : 0}`)

        
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
          setCachedAnalysis(url, result)
          resolve(result)
          return
        }

        const formats = (info.formats || [])
          .filter((f: any) => f.vcodec !== 'none' || f.acodec !== 'none')
          .map((f: any) => ({
            formatId: f.format_id,
            ext: f.ext,
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

        
        let finalDislikes = info.dislike_count;
        if (isYouTubeUrl(url) && info.id) {
          try {
            const rydApiBase = process.env.RYD_API_URL || 'https://returnyoutubedislikeapi.com/votes?videoId='
            const rydResponse = await fetchJson(`${rydApiBase}${info.id}`);
            if (rydResponse && typeof rydResponse.dislikes === 'number') {
              finalDislikes = rydResponse.dislikes;
              log.info(`[RYD API] Fetched actual dislikes: ${finalDislikes}`);
            }
          } catch (rydErr) {
            log.warn('[RYD API] Failed to fetch dislikes:', rydErr);
          }
        }

        const result: AnalyzeResult = {
          kind: 'ytdlp',
          title: info.title || 'Unknown Title',
          thumbnail: extractedThumbnail ? String(extractedThumbnail) : undefined,
          formats,
          views: info.view_count,
          likes: info.like_count,
          dislikes: finalDislikes,
          duration: info.duration,
          subtitles
        };

        setCachedAnalysis(url, result);
        resolve(result);
      } catch (err) {
        log.error('Failed to parse yt-dlp output:', err)
        resolve({ kind: 'unknown' })
      }
    })
  })
}

export async function getDirectStreamUrl(
  url: string,
): Promise<string> {
  const TIMEOUT_MS = 30_000 

  const ytdlpPath = getBinaryPath('yt-dlp')
  if (!existsSync(ytdlpPath)) {
    throw new Error('yt-dlp binary not found. Please ensure it exists in the bin directory.')
  }

  
  
  
  
  
  
  const formatSelectors = ['22/18', 'b[ext=mp4]', 'best']

  let lastError: string = ''

  for (const formatSelector of formatSelectors) {
    const args: string[] = [
      '-f', formatSelector,
      '-g',                    // print direct URL only
      '--no-playlist',
      '--no-check-certificate',
      '--geo-bypass',
      '--force-ipv4',
      '--no-warnings',
      '--socket-timeout', '10',
      '--no-cache-dir',
      // Guard: only pass --extractor-args when the value is non-empty.
      // Passing an empty string causes yt-dlp to throw:
      //   "wrong --extractor-args formatting; it should be IE_KEY:ARGS, not """
      ...(YOUTUBE_EXTRACTOR_ARGS ? ['--extractor-args', YOUTUBE_EXTRACTOR_ARGS] : []),
      ...getYtdlpCookieArgs(),
    ]

    args.push(...getJsRuntimeArgs())

    args.push(url)

    const startMs = Date.now()
    log.info(`[ytdlp] getDirectStreamUrl: trying format "${formatSelector}" for ${url.slice(0, 80)}...`)

    try {
      const directUrl = await new Promise<string>((resolve, reject) => {
        const p = spawn(ytdlpPath, args, {
          windowsHide: true,
          detached: false,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        })

        let stdout = ''
        let stderr = ''

        p.stdout.on('data', (data) => {
          stdout += data.toString()
        })

        p.stderr.on('data', (data) => {
          stderr += data.toString()
        })

        p.on('error', (err) => {
          reject(new Error(`Failed to spawn yt-dlp: ${err.message}`))
        })

        
        const timer = setTimeout(() => {
          try { p.kill() } catch {
            
          }
          reject(new Error('yt-dlp timed out while extracting stream URL.'))
        }, TIMEOUT_MS)

        p.on('close', (code) => {
          clearTimeout(timer)
          const elapsedMs = Date.now() - startMs
          log.info(`[ytdlp] getDirectStreamUrl format="${formatSelector}" finished in ${elapsedMs}ms (exit ${code})`)

          if (code !== 0) {
            log.warn(`[ytdlp] getDirectStreamUrl stderr: ${stderr.trim()}`)
            reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`))
            return
          }

          
          
          
          const firstUrl = stdout
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0 && line.startsWith('http'))

          if (!firstUrl) {
            reject(new Error('yt-dlp returned no playable URL.'))
            return
          }

          resolve(firstUrl)
        })
      })

      log.info(`[ytdlp] getDirectStreamUrl: success with format "${formatSelector}" (${directUrl.slice(0, 80)}...)`)
      return directUrl
    } catch (err) {
      if (isYouTubeUrl(url) && isYouTubeAuthRequiredError(err)) {
        throw new YouTubeAuthRequiredError()
      }
      lastError = err instanceof Error ? err.message : String(err)
      log.warn(`[ytdlp] getDirectStreamUrl: format "${formatSelector}" failed — ${lastError}`)
      
    }
  }

  throw new Error(`Failed to extract a playable stream URL: ${lastError}`)
}
