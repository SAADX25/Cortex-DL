import { type AnalyzeResult, type YtdlpFormat } from '../../../../Shared/types'

export type TrimPreviewSource = {
  videoUrl: string
  duration: number
  isLive?: boolean
  streamType?: 'progressive' | 'hls'
}

function isSupportedMuxedFormat(format: YtdlpFormat): boolean {
  if (!format.url || !format.vcodec || !format.acodec || format.vcodec === 'none' || format.acodec === 'none') return false
  if (format.protocol && ['m3u8', 'm3u8_native'].includes(format.protocol)) return false

  const supportedVideo = format.ext === 'mp4'
    ? /^(avc1|avc3|h264)/i.test(format.vcodec)
    : format.ext === 'webm' && /^(vp09|vp9|vp08|vp8)/i.test(format.vcodec)
  const supportedAudio = format.ext === 'mp4'
    ? /^(mp4a|aac)/i.test(format.acodec)
    : format.ext === 'webm' && /^(opus|vorbis)/i.test(format.acodec)

  if (!supportedVideo || !supportedAudio) return false
  try {
    return ['http:', 'https:'].includes(new URL(format.url).protocol)
  } catch {
    return false
  }
}

function isHlsFormat(format: YtdlpFormat): boolean {
  if (!format.url) return false
  const isM3u8 = format.protocol === 'm3u8' || format.protocol === 'm3u8_native' || /\.m3u8(\?|#|$)/i.test(format.url)
  if (!isM3u8) return false
  try {
    return ['http:', 'https:'].includes(new URL(format.url).protocol)
  } catch {
    return false
  }
}

export function getTrimPreviewSource(
  formats: YtdlpFormat[],
  selectedQuality: string,
  duration: number,
): TrimPreviewSource | null {
  if (!Number.isFinite(duration) || duration <= 0) return null

  const muxedFormats = formats.filter(isSupportedMuxedFormat)

  if (muxedFormats.length === 0) return { videoUrl: '', duration }

  const selectedHeight = selectedQuality.endsWith('p')
    ? Number(selectedQuality.slice(0, -1))
    : null
  const sorted = [...muxedFormats].sort((a, b) => {
    if (selectedHeight && Number.isFinite(selectedHeight)) {
      const aDistance = Math.abs((a.height ?? 0) - selectedHeight)
      const bDistance = Math.abs((b.height ?? 0) - selectedHeight)
      if (aDistance !== bDistance) return aDistance - bDistance
    }

    const aMp4 = a.ext === 'mp4' ? 1 : 0
    const bMp4 = b.ext === 'mp4' ? 1 : 0
    if (aMp4 !== bMp4) return bMp4 - aMp4

    return (b.height ?? 0) - (a.height ?? 0)
  })

  return { videoUrl: sorted[0].url!, duration }
}

function pickBestHlsFormat(formats: YtdlpFormat[]): YtdlpFormat | null {
  const hlsFormats = formats.filter(isHlsFormat)
  if (hlsFormats.length === 0) return null
  return [...hlsFormats].sort((a, b) => {
    const aPreferred = (a.height ?? 0) <= 720 ? 1 : 0
    const bPreferred = (b.height ?? 0) <= 720 ? 1 : 0
    if (aPreferred !== bPreferred) return bPreferred - aPreferred
    return (b.height ?? 0) - (a.height ?? 0)
  })[0] ?? null
}

export function getTrimmerContext(
  analyzeResult: AnalyzeResult | null,
  selectedQuality: string,
  selectedVariantUrl?: string | null,
): TrimPreviewSource | null {
  if (!analyzeResult) return null

  if (analyzeResult.kind === 'hls-media') {
    return { videoUrl: analyzeResult.url, duration: 0, isLive: true, streamType: 'hls' }
  }

  if (analyzeResult.kind === 'hls-master') {
    const url = selectedVariantUrl || analyzeResult.variants[0]?.url || ''
    if (!url) return null
    return { videoUrl: url, duration: 0, isLive: true, streamType: 'hls' }
  }

  if (analyzeResult.kind !== 'ytdlp' || analyzeResult.preview) return null

  if (analyzeResult.isLive) {
    const hls = pickBestHlsFormat(analyzeResult.formats)
    return {
      videoUrl: hls?.url ?? '',
      duration: 0,
      isLive: true,
      streamType: hls?.url ? 'hls' : undefined,
    }
  }

  if (!analyzeResult.duration || !Number.isFinite(analyzeResult.duration) || analyzeResult.duration <= 0) {
    return null
  }

  const progressive = getTrimPreviewSource(analyzeResult.formats, selectedQuality, analyzeResult.duration)
  if (progressive && progressive.videoUrl) {
    return { ...progressive, isLive: false, streamType: 'progressive' }
  }

  const hls = pickBestHlsFormat(analyzeResult.formats)
  if (hls?.url) {
    return {
      videoUrl: hls.url,
      duration: analyzeResult.duration,
      isLive: false,
      streamType: 'hls',
    }
  }

  return progressive ? { ...progressive, isLive: false } : null
}
