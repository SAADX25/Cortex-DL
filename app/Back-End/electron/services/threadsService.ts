import log from 'electron-log'
import { type AnalyzeResult, type TargetFormat, type YtdlpFormat } from '../types'
import { isAudioFormat } from './mediaService'
import { AnalysisCoordinator } from './analysisService'
import { isThreadsUrl, normalizeAnalysisUrl, threadsCarouselIndex, threadsPostCode } from '../../../Shared/analysisUrl'
import { THREADS_INVALID_URL_CODE, THREADS_NO_MEDIA_CODE, THREADS_POST_UNAVAILABLE_CODE } from '../../../Shared/threadsErrors'
import { type PreviewExtractionOptions, type PreviewStreams } from './thumbnailService'

export const THREADS_REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

const MAX_THREADS_HTML_BYTES = 16 * 1024 * 1024
const THREADS_FETCH_TIMEOUT_MS = 15_000
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000
const ANALYSIS_CACHE_MAX = 50

export interface ThreadsStreamFormat {
  formatId: string
  url: string
  ext: string
  vcodec: string
  acodec: string
  width?: number
  height?: number
  qualityHeight?: number
  fps?: number
  tbr?: number
  filesize: number | null
  resolution: string
  description: string
  isDash: boolean
}

export interface ThreadsResolvedMedia {
  code: string
  canonicalUrl: string
  title: string
  thumbnail?: string
  likes?: number
  duration?: number
  videoFormats: ThreadsStreamFormat[]
  audioFormats: ThreadsStreamFormat[]
  progressiveFormats: ThreadsStreamFormat[]
}

export type ThreadsExtractionResult =
  | { kind: 'media'; media: ThreadsResolvedMedia }
  | { kind: 'playlist'; title: string; items: { id: string; title: string; url: string; thumbnail?: string }[] }

export type ThreadsDownloadPlan =
  | { mode: 'single'; stream: ThreadsStreamFormat }
  | { mode: 'dash-mux'; video: ThreadsStreamFormat; audio: ThreadsStreamFormat }

type AnyRecord = Record<string, any>

function isHttpStreamUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0*39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
}

export function parseIsoDuration(value: string | undefined | null): number | undefined {
  if (!value) return undefined
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value.trim())
  if (!match) return undefined
  const hours = match[1] ? Number(match[1]) : 0
  const minutes = match[2] ? Number(match[2]) : 0
  const seconds = match[3] ? Number(match[3]) : 0
  const total = hours * 3600 + minutes * 60 + seconds
  return Number.isFinite(total) && total > 0 ? total : undefined
}

export function parseFrameRate(value: string | undefined | null): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (trimmed.includes('/')) {
    const [numStr, denStr] = trimmed.split('/')
    const num = Number(numStr)
    const den = Number(denStr)
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      const fps = Math.round(num / den)
      return fps > 0 ? fps : undefined
    }
    return undefined
  }
  const parsed = Math.round(Number(trimmed))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function readXmlAttr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrs)
  return match ? decodeXmlEntities(match[1]) : undefined
}

function normalizeQualityHeight(width?: number, height?: number): number | undefined {
  if (width && width > 0 && height && height > 0) return Math.min(width, height)
  if (height && height > 0) return height
  if (width && width > 0) return width
  return undefined
}

function parseEfgMetadata(url: string): { height?: number; duration?: number } {
  try {
    const efg = new URL(url).searchParams.get('efg')
    if (!efg) return {}
    const decoded = JSON.parse(Buffer.from(efg, 'base64').toString('utf8')) as AnyRecord
    const tag = typeof decoded.vencode_tag === 'string' ? decoded.vencode_tag : ''
    const resMatch = /\.(\d{3,4})\./.exec(tag)
    const height = resMatch ? Number(resMatch[1]) : undefined
    const duration = typeof decoded.duration_s === 'number' && decoded.duration_s > 0 ? decoded.duration_s : undefined
    return {
      height: height && height >= 144 && height <= 4320 ? height : undefined,
      duration,
    }
  } catch {
    return {}
  }
}

export function parseDashManifest(mpd: string): {
  duration?: number
  videos: ThreadsStreamFormat[]
  audios: ThreadsStreamFormat[]
} {
  const duration = parseIsoDuration(/\bmediaPresentationDuration="([^"]+)"/i.exec(mpd)?.[1])
  const videos: ThreadsStreamFormat[] = []
  const audios: ThreadsStreamFormat[] = []

  const seenUrls = new Set<string>()
  const adaptationRegex = /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi
  const adaptationBlocks: { attrs: string; body: string }[] = []
  let am: RegExpExecArray | null
  while ((am = adaptationRegex.exec(mpd)) !== null) {
    adaptationBlocks.push({ attrs: am[1], body: am[2] })
  }
  if (adaptationBlocks.length === 0) {
    adaptationBlocks.push({ attrs: '', body: mpd })
  }

  for (const block of adaptationBlocks) {
    const setType = (readXmlAttr(block.attrs, 'contentType') ?? readXmlAttr(block.attrs, 'mimeType') ?? '').toLowerCase()
    const repRegex = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gi
    let rm: RegExpExecArray | null
    while ((rm = repRegex.exec(block.body)) !== null) {
      const attrs = rm[1]
      const body = rm[2]
      const baseUrlRaw = /<BaseURL[^>]*>([^<]+)<\/BaseURL>/i.exec(body)?.[1]
      if (!baseUrlRaw) continue
      const streamUrl = decodeXmlEntities(baseUrlRaw.trim())
      if (!isHttpStreamUrl(streamUrl) || seenUrls.has(streamUrl)) continue

      const id = readXmlAttr(attrs, 'id') ?? `dash-${videos.length + audios.length + 1}`
      const mimeType = (readXmlAttr(attrs, 'mimeType') ?? setType).toLowerCase()
      const codecs = readXmlAttr(attrs, 'codecs') ?? ''
      const bandwidth = Number(readXmlAttr(attrs, 'bandwidth') ?? '0')
      const tbr = Number.isFinite(bandwidth) && bandwidth > 0 ? Math.round(bandwidth / 1000) : 0
      const contentLen = Number(readXmlAttr(attrs, 'FBContentLength') ?? '0')
      const filesize = Number.isFinite(contentLen) && contentLen > 0 ? contentLen : null
      const width = Number(readXmlAttr(attrs, 'width') ?? '0') || undefined
      const height = Number(readXmlAttr(attrs, 'height') ?? '0') || undefined
      const fps = parseFrameRate(readXmlAttr(attrs, 'frameRate'))
      const qualityLabel = readXmlAttr(attrs, 'FBQualityLabel')

      const isAudio = mimeType.startsWith('audio/')
        || setType.startsWith('audio')
        || (!width && !height && /^(?:mp4a|aac|opus|vorbis)/i.test(codecs))
      seenUrls.add(streamUrl)

      if (isAudio) {
        const ext = mimeType.includes('webm') ? 'webm' : 'm4a'
        audios.push({
          formatId: `dash-${id}`,
          url: streamUrl,
          ext,
          vcodec: 'none',
          acodec: codecs || 'mp4a.40.2',
          tbr,
          filesize,
          resolution: 'audio only',
          description: `${tbr ? `${tbr}kbps` : 'audio'}`.trim(),
          isDash: true,
        })
      } else {
        const qualityHeight = normalizeQualityHeight(width, height)
        const resolution = width && height ? `${width}x${height}` : qualityLabel ?? 'video'
        const ext = mimeType.includes('webm') ? 'webm' : 'mp4'
        const description = [qualityLabel, fps ? `${fps}fps` : '', tbr ? `${tbr}kbps` : ''].filter(Boolean).join(' ')
        videos.push({
          formatId: `dash-${id}`,
          url: streamUrl,
          ext,
          vcodec: codecs || 'avc1',
          acodec: 'none',
          width,
          height,
          qualityHeight,
          fps,
          tbr,
          filesize,
          resolution,
          description,
          isDash: true,
        })
      }
    }
  }

  return { duration, videos, audios }
}

function cleanCaptionTitle(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const cleaned = raw
    .replace(/[\u2593\u25a1\uFFFC]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}...` : cleaned
}

function pickBestThumbnail(media: AnyRecord, post: AnyRecord, fallbackOgImage?: string): string | undefined {
  const candidates: AnyRecord[] = []
  if (Array.isArray(media?.image_versions2?.candidates)) candidates.push(...media.image_versions2.candidates)
  if (Array.isArray(post?.image_versions2?.candidates)) candidates.push(...post.image_versions2.candidates)
  const valid = candidates
    .filter(c => isHttpStreamUrl(c?.url))
    .sort((a, b) => ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)))
  if (valid[0]?.url) return valid[0].url
  const linkPreviewImg = post?.text_post_app_info?.link_preview_attachment?.image_url
  if (isHttpStreamUrl(linkPreviewImg)) return linkPreviewImg
  if (isHttpStreamUrl(fallbackOgImage)) return fallbackOgImage
  return undefined
}

function hasVideoPayload(node: AnyRecord | null | undefined): boolean {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node.video_versions) && node.video_versions.some((v: AnyRecord) => isHttpStreamUrl(v?.url))) return true
  if (typeof node.video_dash_manifest === 'string' && node.video_dash_manifest.includes('<BaseURL')) return true
  return false
}

function hasAudioPayload(node: AnyRecord | null | undefined): boolean {
  return Boolean(node && typeof node === 'object' && isHttpStreamUrl(node.audio?.audio_src))
}

function hasPlayableMedia(node: AnyRecord | null | undefined): boolean {
  return hasVideoPayload(node) || hasAudioPayload(node)
}

function buildResolvedMedia(
  mediaNode: AnyRecord,
  rootPost: AnyRecord,
  code: string,
  canonicalUrl: string,
  fallbackOg: { title?: string; description?: string; image?: string },
): ThreadsResolvedMedia {
  const videoFormats: ThreadsStreamFormat[] = []
  const audioFormats: ThreadsStreamFormat[] = []
  const progressiveFormats: ThreadsStreamFormat[] = []

  let duration: number | undefined
  if (typeof mediaNode.video_duration === 'number' && mediaNode.video_duration > 0) {
    duration = mediaNode.video_duration
  } else if (typeof rootPost.video_duration === 'number' && rootPost.video_duration > 0) {
    duration = rootPost.video_duration
  }

  if (typeof mediaNode.video_dash_manifest === 'string' && mediaNode.video_dash_manifest.length > 0) {
    const dash = parseDashManifest(mediaNode.video_dash_manifest)
    if (dash.duration && !duration) duration = dash.duration
    videoFormats.push(...dash.videos)
    audioFormats.push(...dash.audios)
  }

  if (Array.isArray(mediaNode.video_versions)) {
    const seenProg = new Set<string>()
    const origW = typeof mediaNode.original_width === 'number' ? mediaNode.original_width : undefined
    const origH = typeof mediaNode.original_height === 'number' ? mediaNode.original_height : undefined
    const fallbackQualityHeight = normalizeQualityHeight(origW, origH)

    mediaNode.video_versions.forEach((version: AnyRecord, idx: number) => {
      const streamUrl = version?.url
      if (!isHttpStreamUrl(streamUrl) || seenProg.has(streamUrl)) return
      seenProg.add(streamUrl)

      const efg = parseEfgMetadata(streamUrl)
      if (efg.duration && !duration) duration = efg.duration
      const hasExplicitDims = typeof version.width === 'number' && version.width > 0 && typeof version.height === 'number' && version.height > 0
      const width = hasExplicitDims ? version.width : (!videoFormats.length ? origW : undefined)
      const height = hasExplicitDims ? version.height : (!videoFormats.length ? origH : undefined)
      const inferredFallback = videoFormats.length > 0 && fallbackQualityHeight && fallbackQualityHeight > 720
        ? 720
        : fallbackQualityHeight
      const qualityHeight = efg.height ?? normalizeQualityHeight(width, height) ?? inferredFallback
      const resolution = width && height ? `${width}x${height}` : qualityHeight ? `${qualityHeight}p` : 'video'
      const format: ThreadsStreamFormat = {
        formatId: `prog-${version.type ?? idx + 1}`,
        url: streamUrl,
        ext: 'mp4',
        vcodec: 'avc1',
        acodec: 'mp4a.40.2',
        width,
        height,
        qualityHeight,
        fps: 30,
        tbr: 0,
        filesize: null,
        resolution,
        description: `${qualityHeight ? `${qualityHeight}p ` : ''}(Muxed)`.trim(),
        isDash: false,
      }
      progressiveFormats.push(format)
      videoFormats.push(format)
    })
  }

  if (hasAudioPayload(mediaNode)) {
    const audioUrl = mediaNode.audio.audio_src as string
    const durMs = typeof mediaNode.audio.duration_ms === 'number' ? mediaNode.audio.duration_ms : 0
    if (durMs > 0 && !duration) duration = durMs / 1000
    audioFormats.push({
      formatId: 'threads-audio',
      url: audioUrl,
      ext: 'm4a',
      vcodec: 'none',
      acodec: 'mp4a.40.2',
      tbr: 128,
      filesize: null,
      resolution: 'audio only',
      description: 'Audio',
      isDash: false,
    })
  }

  if (videoFormats.length === 0 && audioFormats.length === 0) {
    throw new Error(THREADS_NO_MEDIA_CODE)
  }

  videoFormats.sort((a, b) =>
    (b.qualityHeight ?? b.height ?? 0) - (a.qualityHeight ?? a.height ?? 0)
    || (b.fps ?? 0) - (a.fps ?? 0)
    || (b.tbr ?? 0) - (a.tbr ?? 0))
  audioFormats.sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))

  const username = rootPost?.user?.username || mediaNode?.user?.username
  const title =
    cleanCaptionTitle(rootPost?.caption?.text)
    || cleanCaptionTitle(mediaNode?.caption?.text)
    || cleanCaptionTitle(rootPost?.text_post_app_info?.link_preview_attachment?.title)
    || cleanCaptionTitle(fallbackOg.description)
    || (username ? `@${username} on Threads` : '')
    || cleanCaptionTitle(fallbackOg.title)
    || `Threads ${code}`

  const thumbnail = pickBestThumbnail(mediaNode, rootPost, fallbackOg.image)
  const likes = typeof rootPost?.like_count === 'number'
    ? rootPost.like_count
    : typeof mediaNode?.like_count === 'number'
      ? mediaNode.like_count
      : undefined

  return {
    code,
    canonicalUrl,
    title,
    thumbnail,
    likes,
    duration,
    videoFormats,
    audioFormats,
    progressiveFormats,
  }
}

function scorePostCandidate(node: AnyRecord): number {
  let score = 0
  if ('text_post_app_info' in node && node.text_post_app_info) score += 20
  if (hasPlayableMedia(node)) score += 30
  if (Array.isArray(node.carousel_media) && node.carousel_media.length > 0) score += 25
  if (node.text_post_app_info?.linked_inline_media) score += 25
  if (node.caption?.text) score += 5
  if (node.user?.username) score += 5
  if (typeof node.like_count === 'number') score += 3
  return score
}

function findMatchingPost(root: unknown, postCode: string): AnyRecord | null {
  let best: AnyRecord | null = null
  let bestScore = -1
  const visited = new Set<unknown>()

  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)

    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i--) stack.push(current[i])
      continue
    }

    const record = current as AnyRecord
    if (record.code === postCode) {
      const score = scorePostCandidate(record)
      if (score > bestScore) {
        best = record
        bestScore = score
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') stack.push(value)
    }
  }

  return best
}

function extractOgMeta(html: string): { title?: string; description?: string; image?: string } {
  const readMeta = (prop: string): string | undefined => {
    const m1 = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html)
    if (m1?.[1]) return decodeXmlEntities(m1[1])
    const m2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, 'i').exec(html)
    if (m2?.[1]) return decodeXmlEntities(m2[1])
    return undefined
  }
  return {
    title: readMeta('og:title'),
    description: readMeta('og:description'),
    image: readMeta('og:image'),
  }
}

function resolvePostNode(
  post: AnyRecord,
  rootPost: AnyRecord,
  code: string,
  canonicalUrl: string,
  carouselIndex: number | null,
  fallbackOg: { title?: string; description?: string; image?: string },
  depth = 0,
): ThreadsExtractionResult {
  if (post.text_post_app_info?.is_post_unavailable === true) {
    throw new Error(THREADS_POST_UNAVAILABLE_CODE)
  }

  if (Array.isArray(post.carousel_media) && post.carousel_media.length > 0) {
    const playableItems = post.carousel_media.filter((item: AnyRecord) => hasPlayableMedia(item))
    if (playableItems.length > 0) {
      if (carouselIndex !== null) {
        const chosen = playableItems[carouselIndex]
        if (!chosen) throw new Error(THREADS_NO_MEDIA_CODE)
        return { kind: 'media', media: buildResolvedMedia(chosen, rootPost, code, canonicalUrl, fallbackOg) }
      }
      if (playableItems.length === 1) {
        return { kind: 'media', media: buildResolvedMedia(playableItems[0], rootPost, code, canonicalUrl, fallbackOg) }
      }
      const baseUrl = canonicalUrl.split('?')[0]
      const baseTitle =
        cleanCaptionTitle(rootPost?.caption?.text)
        || (rootPost?.user?.username ? `@${rootPost.user.username} on Threads` : `Threads ${code}`)
      return {
        kind: 'playlist',
        title: baseTitle,
        items: playableItems.map((item: AnyRecord, index: number) => ({
          id: `${code}-${index + 1}`,
          title: `${baseTitle} (${index + 1}/${playableItems.length})`,
          url: `${baseUrl}?carousel=${index}`,
          thumbnail: pickBestThumbnail(item, rootPost, fallbackOg.image),
        })),
      }
    }
  }

  if (hasVideoPayload(post)) {
    return { kind: 'media', media: buildResolvedMedia(post, rootPost, code, canonicalUrl, fallbackOg) }
  }

  const linked = post.text_post_app_info?.linked_inline_media
  if (linked && typeof linked === 'object' && depth < 2) {
    if (hasPlayableMedia(linked) || (Array.isArray(linked.carousel_media) && linked.carousel_media.some((item: AnyRecord) => hasPlayableMedia(item)))) {
      return resolvePostNode(linked, rootPost, code, canonicalUrl, carouselIndex, fallbackOg, depth + 1)
    }
  }

  if (hasAudioPayload(post)) {
    return { kind: 'media', media: buildResolvedMedia(post, rootPost, code, canonicalUrl, fallbackOg) }
  }

  if (depth < 1) {
    const shareInfo = post.text_post_app_info?.share_info
    const nestedCandidates = [
      shareInfo?.reposted_post,
      shareInfo?.quoted_post,
      shareInfo?.quoted_attachment_post,
    ].filter((item): item is AnyRecord => Boolean(item && typeof item === 'object'))

    for (const nested of nestedCandidates) {
      try {
        return resolvePostNode(nested, rootPost, code, canonicalUrl, carouselIndex, fallbackOg, depth + 1)
      } catch (error) {
        if (error instanceof Error && error.message === THREADS_NO_MEDIA_CODE) continue
        throw error
      }
    }
  }

  throw new Error(THREADS_NO_MEDIA_CODE)
}

export function parseThreadsHtml(
  html: string,
  postCode: string,
  canonicalUrl: string,
  carouselIndex: number | null = null,
): ThreadsExtractionResult {
  const fallbackOg = extractOgMeta(html)
  const scriptRegex = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
  let bestPost: AnyRecord | null = null
  let bestScore = -1
  let match: RegExpExecArray | null

  while ((match = scriptRegex.exec(html)) !== null) {
    const body = match[1]
    if (!body || !body.includes(postCode)) continue
    try {
      const parsed = JSON.parse(body)
      const candidate = findMatchingPost(parsed, postCode)
      if (candidate) {
        const score = scorePostCandidate(candidate)
        if (score > bestScore) {
          bestPost = candidate
          bestScore = score
        }
      }
    } catch {
      continue
    }
  }

  if (!bestPost) {
    throw new Error(THREADS_POST_UNAVAILABLE_CODE)
  }

  return resolvePostNode(bestPost, bestPost, postCode, canonicalUrl, carouselIndex, fallbackOg)
}

async function fetchThreadsHtml(url: string, signal?: AbortSignal): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  const timer = setTimeout(() => controller.abort(new Error('Threads request timed out')), THREADS_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: THREADS_REQUEST_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    })

    if (response.status === 404 || response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {})
      throw new Error(THREADS_POST_UNAVAILABLE_CODE)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`Threads returned HTTP ${response.status}`)
    }
    if (!response.body) throw new Error('Empty Threads response')

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.length
        if (bytes > MAX_THREADS_HTML_BYTES) throw new Error('Threads response exceeds size limit')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }

    return {
      html: Buffer.concat(chunks).toString('utf8'),
      finalUrl: response.url || url,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function resolveThreadsMedia(inputUrl: string, signal?: AbortSignal): Promise<ThreadsExtractionResult> {
  signal?.throwIfAborted()
  if (!isThreadsUrl(inputUrl)) throw new Error(THREADS_INVALID_URL_CODE)
  const normalized = normalizeAnalysisUrl(inputUrl)
  const postCode = threadsPostCode(normalized)
  if (!postCode) throw new Error(THREADS_INVALID_URL_CODE)
  const carouselIndex = threadsCarouselIndex(normalized)

  const fetchTarget = normalized.split('?')[0]
  const { html } = await fetchThreadsHtml(fetchTarget, signal)
  signal?.throwIfAborted()
  return parseThreadsHtml(html, postCode, normalized, carouselIndex)
}

function toAnalyzeFormats(media: ThreadsResolvedMedia): YtdlpFormat[] {
  const combined = [...media.videoFormats, ...media.audioFormats]
  const seen = new Set<string>()
  const formats: YtdlpFormat[] = []

  for (const item of combined) {
    if (seen.has(item.formatId)) continue
    seen.add(item.formatId)
    formats.push({
      formatId: item.formatId,
      ext: item.ext,
      vcodec: item.vcodec,
      acodec: item.acodec,
      resolution: item.resolution,
      filesize: item.filesize,
      description: item.description,
      url: item.url,
      tbr: item.tbr ?? 0,
      height: item.qualityHeight ?? item.height ?? 0,
      fps: item.fps ?? 0,
    })
  }

  return formats.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0))
}

const threadsAnalysisCoordinator = new AnalysisCoordinator<AnalyzeResult>(
  3,
  ANALYSIS_CACHE_TTL_MS,
  ANALYSIS_CACHE_MAX,
  Date.now,
  result => result.kind !== 'unknown',
  result => {
    if (result.kind === 'ytdlp') result.formats = result.formats.map(({ url: _url, ...format }) => format)
    return result
  },
)

export async function analyzeThreadsUrl(url: string, signal?: AbortSignal): Promise<AnalyzeResult> {
  signal?.throwIfAborted()
  const normalized = normalizeAnalysisUrl(url)
  return threadsAnalysisCoordinator.run(normalized, async (targetUrl, ownedSignal) => {
    const startMs = Date.now()
    log.info('[threads] Analysis started')
    try {
      const extracted = await resolveThreadsMedia(targetUrl, ownedSignal)
      if (extracted.kind === 'playlist') {
        return {
          kind: 'playlist',
          title: extracted.title,
          items: extracted.items,
        }
      }

      const { media } = extracted
      return {
        kind: 'ytdlp',
        title: media.title,
        thumbnail: media.thumbnail,
        formats: toAnalyzeFormats(media),
        likes: media.likes,
        duration: media.duration ? Math.round(media.duration) : undefined,
        qualityStatus: 'available',
      }
    } finally {
      log.info(`[threads] Analysis finished in ${Date.now() - startMs}ms`)
    }
  }, signal, 'threads')
}

function parseRequestedMaxHeight(formatId?: string | null): number | null {
  if (!formatId) return null
  const match = /^(\d{2,5})p$/i.exec(formatId.trim())
  if (!match) return null
  const height = parseInt(match[1], 10)
  return Number.isFinite(height) && height > 0 ? height : null
}

function isH264Codec(vcodec?: string): boolean {
  return Boolean(vcodec && /^(?:avc1|avc3|h264)/i.test(vcodec))
}

function pickBestVideoStream(streams: ThreadsStreamFormat[], maxHeight: number | null, fallbackToSmallest = true): ThreadsStreamFormat | null {
  if (streams.length === 0) return null
  const within = maxHeight
    ? streams.filter(s => (s.qualityHeight ?? s.height ?? 0) <= maxHeight)
    : streams
  if (within.length === 0 && !fallbackToSmallest) return null
  const pool = within.length > 0
    ? within
    : [...streams].sort((a, b) => (a.qualityHeight ?? a.height ?? 0) - (b.qualityHeight ?? b.height ?? 0)).slice(0, 1)

  return [...pool].sort((a, b) =>
    (b.qualityHeight ?? b.height ?? 0) - (a.qualityHeight ?? a.height ?? 0)
    || (b.fps ?? 0) - (a.fps ?? 0)
    || Number(isH264Codec(b.vcodec)) - Number(isH264Codec(a.vcodec))
    || (b.tbr ?? 0) - (a.tbr ?? 0))[0] ?? null
}

export function selectThreadsDownloadPlan(
  media: ThreadsResolvedMedia,
  targetFormat: TargetFormat,
  ytdlpFormatId?: string | null,
): ThreadsDownloadPlan {
  const bestAudio = media.audioFormats[0] ?? null
  const bestProgressive = media.progressiveFormats[0] ?? null

  if (isAudioFormat(targetFormat)) {
    if (bestAudio) return { mode: 'single', stream: bestAudio }
    if (bestProgressive) return { mode: 'single', stream: bestProgressive }
    throw new Error(THREADS_NO_MEDIA_CODE)
  }

  const maxHeight = parseRequestedMaxHeight(ytdlpFormatId)
  const dashVideos = media.videoFormats.filter(f => f.isDash)
  const bestDashVideo = pickBestVideoStream(dashVideos, maxHeight, false)
    ?? (media.progressiveFormats.some(s => !maxHeight || (s.qualityHeight ?? s.height ?? 0) <= maxHeight)
      ? null
      : pickBestVideoStream(dashVideos, maxHeight, true))
  const bestProgForHeight = pickBestVideoStream(media.progressiveFormats, maxHeight, !bestDashVideo)

  if (bestDashVideo) {
    const dashH = bestDashVideo.qualityHeight ?? bestDashVideo.height ?? 0
    const progH = bestProgForHeight ? (bestProgForHeight.qualityHeight ?? bestProgForHeight.height ?? 0) : 0
    const dashFps = bestDashVideo.fps ?? 0
    const progFps = bestProgForHeight?.fps ?? 0

    const preferDash =
      !bestProgForHeight
      || dashH > progH
      || (dashH === progH && dashFps > progFps)
      || (dashH === progH && dashFps === progFps && (bestDashVideo.tbr ?? 0) > (bestProgForHeight.tbr ?? 0) && bestDashVideo.tbr! > 0)

    if (preferDash) {
      if (bestAudio) return { mode: 'dash-mux', video: bestDashVideo, audio: bestAudio }
      return { mode: 'single', stream: bestDashVideo }
    }
  }

  if (bestProgForHeight) return { mode: 'single', stream: bestProgForHeight }
  if (bestAudio) return { mode: 'single', stream: bestAudio }
  throw new Error(THREADS_NO_MEDIA_CODE)
}

export async function getThreadsPreviewStreams(url: string, options: PreviewExtractionOptions = {}): Promise<PreviewStreams | null> {
  if (options.isClosed?.()) return null
  const controller = new AbortController()
  const untrack = options.track?.(() => controller.abort(new Error('Preview extraction cancelled'))) ?? (() => {})
  try {
    const extracted = await resolveThreadsMedia(url, controller.signal)
    if (extracted.kind !== 'media') throw new Error(THREADS_NO_MEDIA_CODE)
    const { media } = extracted
    if (media.progressiveFormats[0]?.url) {
      return { videoUrl: media.progressiveFormats[0].url }
    }
    const dashVideo = media.videoFormats.find(f => f.isDash && f.ext === 'mp4') ?? media.videoFormats[0]
    if (!dashVideo?.url) throw new Error(THREADS_NO_MEDIA_CODE)
    return {
      videoUrl: dashVideo.url,
      audioUrl: media.audioFormats[0]?.url,
    }
  } catch (error) {
    if (controller.signal.aborted || options.isClosed?.()) return null
    throw error
  } finally {
    untrack()
  }
}

export async function getThreadsDirectStreamUrl(url: string, options: PreviewExtractionOptions = {}): Promise<string> {
  const streams = await getThreadsPreviewStreams(url, options)
  if (!streams?.videoUrl) throw new Error('Preview extraction cancelled')
  return streams.videoUrl
}
