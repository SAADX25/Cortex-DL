import os from 'node:os'
import path from 'node:path'
import { readdir, stat, unlink, mkdir, rm } from 'node:fs/promises'
import log from 'electron-log'
import { youtubeErrorCode, getErrorText, isYouTubeUrl, isYouTubeAuthRequiredError, YOUTUBE_AUTH_REQUIRED_CODE, YOUTUBE_BOT_VERIFICATION_CODE } from '../../../Shared/youtubeErrors'
import { buildInfo } from '../diagnostics'
import { type AnalyzeResult, type JsRuntimeStatus } from '../types'
import { existsSync } from 'node:fs'
import { downloadEngine, promoteEngine, verifyEngine, engineReceipts, ensureEnginesReady } from './engineManager'
import { getBinaryPath, getBinDirectory } from '../paths'
import { analysisTiming, AnalysisCoordinator, extractAnalysis, fetchBoundedJson } from '../services/analysisService'
import { normalizeAnalysisUrl } from '../../../Shared/analysisUrl'
import { extractPreview, extractPreviewStreams, PREVIEW_FORMAT, TRIM_PREVIEW_FORMAT, type PreviewStreams, type PreviewExtractionOptions } from '../services/thumbnailService'

const directory = path.join(os.tmpdir(), 'cortexdl-ytdlp-cache')

let lastCleanup = 0

export function ytdlpCacheArgs(): string[] {
  if (Date.now() - lastCleanup > 3600000) {
    lastCleanup = Date.now()
    void prune(directory).catch(() => {})
  }
  return ['--cache-dir', directory]
}

async function prune(root: string): Promise<void> {
  const entries: { file: string; size: number; mtimeMs: number }[] = []
  const walk = async (folder: string): Promise<void> => {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name)
      if (item.isDirectory()) await walk(file)
      else if (item.isFile()) {
        const info = await stat(file).catch(() => null)
        if (info) entries.push({ file, size: info.size, mtimeMs: info.mtimeMs })
      }
    }
  }
  await walk(root)
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  let size = 0
  for (const entry of entries) {
    size += entry.size
    const age = Date.now() - entry.mtimeMs
    if (age > 30 * 86400000 || (size > 64 * 1024 * 1024 && age > 60000)) await unlink(entry.file).catch(() => {})
  }
}

export function diagnosticCategories(text: string): string[] {
  const categories = new Set<string>()
  const code = youtubeErrorCode(text)
  if (code) categories.add(code)
  if (/JavaScript runtime|challenge solving|n challenge|signature extraction/i.test(text)) categories.add('js-challenge')
  if (/SABR|formats have been skipped|missing a url/i.test(text)) categories.add('formats-skipped')
  return [...categories]
}

export function youtubeDiagnostic(event: string, data: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'development' || process.env.CORTEX_YOUTUBE_DEBUG === '1') {
    log.info('[youtube diagnostic]', { event, app: buildInfo(), ...data })
  }
}

export { isYouTubeAuthRequiredError, YOUTUBE_AUTH_REQUIRED_CODE } from '../../../Shared/youtubeErrors'

const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000

const ANALYSIS_CACHE_MAX = 50

export class YouTubeAuthRequiredError extends Error {
  readonly code = YOUTUBE_AUTH_REQUIRED_CODE

  constructor() {
    super(
      `${YOUTUBE_AUTH_REQUIRED_CODE}: This video requires YouTube viewing permission. ` +
      'Video analysis was blocked by YouTube.',
    )
    this.name = 'YouTubeAuthRequiredError'
  }
}

type JsRuntimeSelection = { args: string[]; available: boolean; name: string }

const analysisCoordinator = new AnalysisCoordinator<AnalyzeResult>(3, ANALYSIS_CACHE_TTL_MS, ANALYSIS_CACHE_MAX, Date.now, result => result.kind !== 'unknown', result => {
  if (result.kind === 'ytdlp') result.formats = result.formats.map(({ url: _url, ...format }) => format)
  return result
})

let runtimeSelection: JsRuntimeSelection = { args: [], available: false, name: 'Checking Deno' }

async function prepareYtdlp(): Promise<void> {
  await ensureEnginesReady(['yt-dlp', 'deno'])
  await checkJsRuntime()
}

const analysisCooldown = new Map<string, { code: string; until: number }>()

export function assertAnalysisAllowed(input: string): void {
  const key = `${normalizeAnalysisUrl(input)}\0public`
  const cooldown = analysisCooldown.get(key)
  if (cooldown && cooldown.until > Date.now()) throw new Error(cooldown.code)
  analysisCooldown.delete(key)
}

export async function getYtdlpVersion(): Promise<string> {
  const health = await engineReceipts.inspect('yt-dlp')
  return health.available ? health.version : health.state === 'repair-required' ? 'Not Installed' : 'Unknown'
}

let updateInFlight = false

export async function updateYtdlp(): Promise<{ success: boolean; message: string; version?: string }> {
  if (updateInFlight) return { success: false, message: 'Engine update already in progress.' }
  updateInFlight = true
  const binDir = getBinDirectory()
  const candidate = path.join(binDir, 'yt-dlp-update.tmp')
  try {
    await mkdir(binDir, { recursive: true })
    const release = await fetchBoundedJson('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', undefined, 8000)
    const asset = release.assets?.find((a: any) => a.name === 'yt-dlp.exe')
    if (!asset?.digest?.startsWith('sha256:') || !asset.browser_download_url?.startsWith('https://github.com/yt-dlp/yt-dlp/releases/download/')) throw new Error('Verified release asset unavailable')
    await downloadEngine(asset.browser_download_url, candidate, asset.digest.slice(7))
    const spec = { name: 'yt-dlp', filename: 'yt-dlp.exe', minimum: '2026.06.09', architecture: 'x64', version: release.tag_name, sha256: asset.digest.slice(7) }
    const check = await verifyEngine(candidate, spec)
    if (!check.available) throw new Error(check.message)
    const final = path.join(binDir, 'yt-dlp.exe')
    await promoteEngine(candidate, final, spec)
    await engineReceipts.record('yt-dlp', check.version, spec.sha256)
    return { success: true, message: `Updated to ${check.version}`, version: check.version }
  } catch (error) {
    log.error('[Engine update]', error)
    return { success: false, message: 'Engine update failed. Previous working engine was preserved. Open diagnostics for details.' }
  } finally { await rm(candidate, { force: true }); updateInFlight = false }
}

export async function checkJsRuntime(): Promise<JsRuntimeStatus> {
  const health = await engineReceipts.inspect('deno')
  runtimeSelection = health.available
    ? { available: true, name: 'Deno ' + health.version, args: ['--js-runtimes', 'deno:' + getBinaryPath('deno')] }
    : { available: false, name: health.message, args: [] }
  return { available: runtimeSelection.available, name: runtimeSelection.name }
}

export function getJsRuntimeArgs(): string[] { return runtimeSelection.args }

export async function analyzeWithYtdlp(url: string, signal?: AbortSignal): Promise<AnalyzeResult> {
  signal?.throwIfAborted()
  url = normalizeAnalysisUrl(url)
  assertAnalysisAllowed(url)
  await prepareYtdlp()
  signal?.throwIfAborted()
  const scope = 'public'
  const cooldownKey = `${url}\0${scope}`
  assertAnalysisAllowed(url)
  try { return await analysisCoordinator.run(url, (normalized, owned) => extractFullAnalysis(normalized, owned), signal, scope) } catch (error) {
    signal?.throwIfAborted()
    const code = youtubeErrorCode(error)
    if (isYouTubeUrl(url) && (code?.includes('RATE_LIMITED') || code === YOUTUBE_AUTH_REQUIRED_CODE || code === YOUTUBE_BOT_VERIFICATION_CODE)) {
      analysisCooldown.set(cooldownKey, { code, until: Date.now() + 60_000 })
      if (analysisCooldown.size > 50) analysisCooldown.delete(analysisCooldown.keys().next().value!)
    }
    throw error
  }
}

async function extractFullAnalysis(url: string, signal: AbortSignal): Promise<AnalyzeResult> {
  const ytdlpPath = getBinaryPath('yt-dlp')
  if (!existsSync(ytdlpPath)) throw new Error('yt-dlp binary not found in the bin directory')
  const isPlaylist = url.toLowerCase().includes('list=') || url.toLowerCase().includes('/playlist')

  const args = [
    '--ignore-config',
    '--dump-single-json',
    ...ytdlpCacheArgs(),
    isPlaylist ? '--yes-playlist' : '--no-playlist',
    '--geo-bypass',
    '--retries', '0', '--extractor-retries', '0',
    '--socket-timeout', '10',
  ]

  if (isPlaylist) {
    args.push('--flat-playlist')
  }

  args.push(...getJsRuntimeArgs())

  args.push(url)

  const startMs = Date.now()
  log.info('[ytdlp] Analysis started')
  let stdout: string
  let warnings = ''
  try {
    stdout = await extractAnalysis(ytdlpPath, args, signal, undefined, undefined, stderr => { warnings = stderr })
  } catch (error) {
    youtubeDiagnostic('analysis-failure', { mode: 'public', runtime: runtimeSelection.name,
      elapsedMs: Date.now() - startMs, categories: diagnosticCategories(getErrorText(error)) })
    if (isYouTubeUrl(url) && youtubeErrorCode(error) && !isYouTubeAuthRequiredError(error)) throw new Error(youtubeErrorCode(error)!)
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
        let thumbnail = entry.thumbnail;
        if (!thumbnail && entry.thumbnails && entry.thumbnails.length > 0) {
            thumbnail = entry.thumbnails[entry.thumbnails.length - 1].url;
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
            thumbnail: thumbnail ? String(thumbnail) : undefined
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
    .filter((f: any) => !f.has_drm && ((typeof f.vcodec === 'string' && f.vcodec !== 'none') || (typeof f.acodec === 'string' && f.acodec !== 'none')))
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

  let thumbnail = info.thumbnail;
  if (!thumbnail && info.thumbnails && info.thumbnails.length > 0) {
      thumbnail = info.thumbnails[info.thumbnails.length - 1].url;
  }

  const resolutions = [...new Set<number>(formats.map((f: { height: number }) => f.height).filter(Boolean))]
  const categories = diagnosticCategories(warnings)
  youtubeDiagnostic('analysis', { mode: 'public', runtime: runtimeSelection.name,
    ytDlpVersion: await getYtdlpVersion(), elapsedMs: Date.now() - startMs, formatCount: formats.length, resolutions, categories })

  const result: AnalyzeResult = {
    kind: 'ytdlp',
    title: info.title || 'Unknown Title',
    thumbnail: thumbnail ? String(thumbnail) : undefined,
    formats,
    views: info.view_count,
    likes: info.like_count,
    dislikes: info.dislike_count,
    duration: info.duration,
    qualityStatus: categories.some(category => /FORMATS_RESTRICTED|PO_TOKEN_REQUIRED|formats-skipped|js-challenge/.test(category))
      ? 'restricted' : resolutions.length && Math.max(...resolutions) <= 360 ? 'limited' : 'available',
  };

  analysisTiming('fullMetadataMs', startMs)
  return result

}

export async function getTrimPreviewStreams(url: string, options: PreviewExtractionOptions = {}): Promise<PreviewStreams | null> {
  await prepareYtdlp()
  const binary = getBinaryPath('yt-dlp')
  if (!existsSync(binary)) throw new Error('yt-dlp binary not found in the bin directory')
  try {
    return await extractPreviewStreams(binary, [
      '--ignore-config',
      '-f', TRIM_PREVIEW_FORMAT, '--dump-single-json', '--no-playlist', '--geo-bypass', ...ytdlpCacheArgs(),
      '--socket-timeout', '10',
      ...getJsRuntimeArgs(), url,
    ], options)
  } catch (error) {
    if (error instanceof Error && error.message === 'Preview extraction cancelled') return null
    log.error('[ytdlp] Trim preview extraction failed:', error)
    if (isYouTubeUrl(url) && youtubeErrorCode(error) && !isYouTubeAuthRequiredError(error)) throw new Error(youtubeErrorCode(error)!)
    if (isYouTubeUrl(url) && isYouTubeAuthRequiredError(error)) throw new YouTubeAuthRequiredError()
    throw error
  }
}

export async function getDirectStreamUrl(url: string, options: PreviewExtractionOptions = {}): Promise<string> {
  await prepareYtdlp()
  const binary = getBinaryPath('yt-dlp')
  if (!existsSync(binary)) throw new Error('yt-dlp binary not found in the bin directory')
  try {
    return await extractPreview(binary, [
      '--ignore-config',
      '-f', PREVIEW_FORMAT, '--dump-single-json', '--no-playlist', '--geo-bypass', ...ytdlpCacheArgs(),
      '--force-ipv4', '--socket-timeout', '10',
      ...getJsRuntimeArgs(), url,
    ], options)
  } catch (error) {
    log.error('[ytdlp] Preview extraction failed:', error)
    if (isYouTubeUrl(url) && youtubeErrorCode(error) && !isYouTubeAuthRequiredError(error)) throw new Error(youtubeErrorCode(error)!)
    if (isYouTubeUrl(url) && isYouTubeAuthRequiredError(error)) throw new YouTubeAuthRequiredError()
    throw error
  }
}
