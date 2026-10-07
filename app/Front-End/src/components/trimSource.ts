import type { YtdlpFormat } from '../../../Shared/types'

export type TrimPreviewSource = { videoUrl: string; duration: number }

function isSupportedMuxedFormat(format: YtdlpFormat): boolean {
  if (!format.url || !format.vcodec || !format.acodec || format.vcodec === 'none' || format.acodec === 'none') return false

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

export function getTrimPreviewSource(
  formats: YtdlpFormat[],
  selectedQuality: string,
  duration: number,
): TrimPreviewSource | null {
  if (!Number.isFinite(duration) || duration <= 0) return null

  const muxedFormats = formats.filter(isSupportedMuxedFormat)
  // Keep Visual Trim available; it can extract a progressive audio/video source
  // from the original page URL when analysis did not expose a directly playable URL.
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
