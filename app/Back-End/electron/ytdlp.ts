import type { AnalyzeResult, JsRuntimeStatus } from './types'
import type { CaptionDiscovery } from '../../Shared/types'
import { discoverCaptions, captionFailure } from './captionDiscovery'
import { diagnosticCategories, youtubeDiagnostic } from './youtubeDiagnostics'
import log from 'electron-log'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { downloadEngine, promoteEngine, verifyEngine } from './engineIntegrity'
import { getBinaryPath, getBinDirectory } from './paths'
import { engineReceipts, ensureEnginesReady } from './engineReadiness'
import { ytdlpCacheArgs } from './ytdlpCache'
import { analysisTiming } from './analysisTiming'
import { AnalysisCoordinator } from './analysisCoordinator'
import { extractAnalysis } from './analysisProcess'
import { fetchBoundedJson } from './analysisNetwork'
import { extractPreview, extractPreviewStreams, PREVIEW_FORMAT, TRIM_PREVIEW_FORMAT, type PreviewStreams, type PreviewExtractionOptions } from './previewExtraction'
import { getErrorText, isYouTubeUrl, isYouTubeAuthRequiredError, youtubeErrorCode, YOUTUBE_AUTH_REQUIRED_CODE } from '../../Shared/youtubeErrors'
export { isYouTubeAuthRequiredError, YOUTUBE_AUTH_REQUIRED_CODE } from '../../Shared/youtubeErrors'

const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000
const ANALYSIS_CACHE_MAX = 50
export const YOUTUBE_EXTRACTOR_ARGS = ''

export class YouTubeAuthRequiredError extends Error {
  readonly code = YOUTUBE_AUTH_REQUIRED_CODE

  constructor() {
    super(
      `${YOUTUBE_AUTH_REQUIRED_CODE}: YouTube requires sign-in or CAPTCHA verification. ` +
      'For local subtitles, select a video file already on your device.',
    )
    this.name = 'YouTubeAuthRequiredError'
  }
}

type JsRuntimeSelection = { args: string[]; available: boolean; name: string }
const analysisCoordinator = new AnalysisCoordinator<AnalyzeResult>(3, ANALYSIS_CACHE_TTL_MS, ANALYSIS_CACHE_MAX, Date.now, result => result.kind !== 'unknown', result => {
  if (result.kind === 'ytdlp') result.formats = result.formats.map(({ url: _url, ...format }) => format)
  return result
})
// Deno is a mandatory pinned engine. Selection consumes verified metadata only.
let runtimeSelection: JsRuntimeSelection = { args: [], available: false, name: 'Checking Deno' }
async function prepareYtdlp(): Promise<void> {
  await ensureEnginesReady(['yt-dlp', 'deno'])
  await checkJsRuntime()
}
const analysisCooldown = new Map<string, { code: string; until: number }>()

export async function isYtdlpAvailable(): Promise<boolean> {
  return (await engineReceipts.inspect('yt-dlp')).available
}
export async function getYtdlpVersion(): Promise<string> {
  const health = await engineReceipts.inspect('yt-dlp')
  return health.available ? health.version : health.state === 'repair-required' ? 'Not Installed' : 'Unknown'
}

function fetchJson(url: string): Promise<any> {
  return fetchBoundedJson(url, undefined, 8000)
}

let updateInFlight = false
export async function updateYtdlp(): Promise<{ success: boolean; message: string; version?: string }> {
  if (updateInFlight) return { success: false, message: 'Engine update already in progress.' }
  updateInFlight = true
  const binDir = getBinDirectory()
  const candidate = path.join(binDir, 'yt-dlp-update.tmp')
  try {
    await mkdir(binDir, { recursive: true })
    const release = await fetchJson('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')
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

export async function analyzeWithYtdlp(url: string, signal?: AbortSignal, refresh = false): Promise<AnalyzeResult> {
  signal?.throwIfAborted()
  await prepareYtdlp()
  signal?.throwIfAborted()
  const scope = 'public'
  const cooldownKey = `${url}\0${scope}`
  const cooldown = analysisCooldown.get(cooldownKey)
  if (cooldown && cooldown.until > Date.now()) throw new Error(cooldown.code)
  analysisCooldown.delete(cooldownKey)
  if (refresh) analysisCoordinator.invalidate(url, scope)
  try { return await analysisCoordinator.run(url, (normalized, owned) => extractFullAnalysis(normalized, owned), signal, scope) } catch (error) {
    signal?.throwIfAborted()
    const code = youtubeErrorCode(error)
    if (isYouTubeUrl(url) && (code?.includes('RATE_LIMITED') || code === YOUTUBE_AUTH_REQUIRED_CODE)) {
      analysisCooldown.set(cooldownKey, { code, until: Date.now() + 60_000 })
      if (analysisCooldown.size > 50) analysisCooldown.delete(analysisCooldown.keys().next().value!)
    }
    throw error
  }
}

const captionCoordinator = new AnalysisCoordinator<CaptionDiscovery>(2, 60_000, 50)
export async function refreshYouTubeCaptions(url: string, signal: AbortSignal): Promise<CaptionDiscovery> {
  if (!isYouTubeUrl(url)) throw new Error('Caption refresh requires a YouTube URL')
  await prepareYtdlp()
  return captionCoordinator.run(url, async (normalized, owned) => {
    try {
      let warnings = ''
      const output = await extractAnalysis(getBinaryPath('yt-dlp'), [
        '--ignore-config', '--dump-single-json', '--skip-download', '--ignore-no-formats-error', '--no-playlist',
        '--socket-timeout', '10', '--retries', '0', '--extractor-retries', '0',
        ...ytdlpCacheArgs(), ...getJsRuntimeArgs(), normalized,
      ], owned, undefined, undefined, stderr => { warnings = stderr })
      return discoverCaptions(JSON.parse(output), warnings)
    } catch (error) { owned.throwIfAborted(); return captionFailure(error) }
  }, signal, 'public')
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
    ...(YOUTUBE_EXTRACTOR_ARGS ? ['--extractor-args', YOUTUBE_EXTRACTOR_ARGS] : []),
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

  let extractedThumbnail = info.thumbnail;
  if (!extractedThumbnail && info.thumbnails && info.thumbnails.length > 0) {
      extractedThumbnail = info.thumbnails[info.thumbnails.length - 1].url;
  }

  const captionDiscovery = discoverCaptions(info, warnings)
  const subtitles = captionDiscovery.subtitles
  const resolutions = [...new Set<number>(formats.map((f: { height: number }) => f.height).filter(Boolean))]
  const categories = diagnosticCategories(warnings)
  youtubeDiagnostic('analysis', { mode: 'public', runtime: runtimeSelection.name,
    ytDlpVersion: await getYtdlpVersion(), elapsedMs: Date.now() - startMs, formatCount: formats.length, resolutions, categories,
    manualCaptions: subtitles.filter(track => !track.isAutomatic).length, automaticCaptions: subtitles.filter(track => track.isAutomatic).length })


  const result: AnalyzeResult = {
    kind: 'ytdlp',
    title: info.title || 'Unknown Title',
    thumbnail: extractedThumbnail ? String(extractedThumbnail) : undefined,
    formats,
    views: info.view_count,
    likes: info.like_count,
    dislikes: info.dislike_count,
    duration: info.duration,
    subtitles, captionDiscovery,
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
      ...(YOUTUBE_EXTRACTOR_ARGS ? ['--extractor-args', YOUTUBE_EXTRACTOR_ARGS] : []),
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
      ...(YOUTUBE_EXTRACTOR_ARGS ? ['--extractor-args', YOUTUBE_EXTRACTOR_ARGS] : []),
      ...getJsRuntimeArgs(), url,
    ], options)
  } catch (error) {
    log.error('[ytdlp] Preview extraction failed:', error)
    if (isYouTubeUrl(url) && youtubeErrorCode(error) && !isYouTubeAuthRequiredError(error)) throw new Error(youtubeErrorCode(error)!)
    if (isYouTubeUrl(url) && isYouTubeAuthRequiredError(error)) throw new YouTubeAuthRequiredError()
    throw error
  }
}
