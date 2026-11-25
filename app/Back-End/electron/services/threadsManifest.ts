// Pure MPEG-DASH MPD XML parser and stream metadata helpers for Threads posts
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
  | {
      kind: 'playlist'
      title: string
      items: { id: string; title: string; url: string; thumbnail?: string }[]
    }

export type ThreadsDownloadPlan =
  | { mode: 'single'; stream: ThreadsStreamFormat }
  | { mode: 'dash-mux'; video: ThreadsStreamFormat; audio: ThreadsStreamFormat }

export function isHttpStreamUrl(value: unknown): value is string {
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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0*39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    })
    .replace(/&#(\d+);/g, (match, dec) => {
      const code = parseInt(dec, 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    })
    .replace(/&amp;/g, '&')
}

export function parseIsoDuration(value: string | undefined | null): number | undefined {
  if (!value) return undefined
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(
    value.trim(),
  )
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

// Use the shorter edge so vertical 1080x1920 clips report as 1080p rather than 1920p.
export function normalizeQualityHeight(width?: number, height?: number): number | undefined {
  if (width && width > 0 && height && height > 0) return Math.min(width, height)
  if (height && height > 0) return height
  if (width && width > 0) return width
  return undefined
}

// Meta CDN URLs embed base64-encoded JSON in ?efg= with encoding resolution and duration.
export function parseEfgMetadata(url: string): { height?: number; duration?: number } {
  try {
    const efg = new URL(url).searchParams.get('efg')
    if (!efg) return {}
    const decoded = JSON.parse(Buffer.from(efg, 'base64').toString('utf8')) as Record<string, any>
    const tag = typeof decoded.vencode_tag === 'string' ? decoded.vencode_tag : ''
    const resMatch = /\.(\d{3,4})\./.exec(tag)
    const height = resMatch ? Number(resMatch[1]) : undefined
    const duration =
      typeof decoded.duration_s === 'number' && decoded.duration_s > 0
        ? decoded.duration_s
        : undefined
    return {
      height: height && height >= 144 && height <= 4320 ? height : undefined,
      duration,
    }
  } catch {
    return {}
  }
}

// Threads embeds inline DASH MPD XML with single-file BaseURL streams and custom FBContentLength/FBQualityLabel attrs.
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
    const setType = (
      readXmlAttr(block.attrs, 'contentType') ??
      readXmlAttr(block.attrs, 'mimeType') ??
      ''
    ).toLowerCase()
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

      const isAudio =
        mimeType.startsWith('audio/') ||
        setType.startsWith('audio') ||
        (!width && !height && /^(?:mp4a|aac|opus|vorbis)/i.test(codecs))
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
        const resolution = width && height ? `${width}x${height}` : (qualityLabel ?? 'video')
        const ext = mimeType.includes('webm') ? 'webm' : 'mp4'
        const description = [qualityLabel, fps ? `${fps}fps` : '', tbr ? `${tbr}kbps` : '']
          .filter(Boolean)
          .join(' ')
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
