import type { CaptionDiscovery, SubtitleTrack } from '../../Shared/types'
import { youtubeErrorCode, getErrorText } from '../../Shared/youtubeErrors'

export function discoverCaptions(info: Record<string, any>, diagnostics = ''): CaptionDiscovery {
  const tracks = new Map<string, SubtitleTrack>()
  for (const [source, automatic] of [[info.subtitles, false], [info.automatic_captions, true]] as const) {
    if (!source || typeof source !== 'object') continue
    for (const [languageCode, formats] of Object.entries(source)) {
      if (!Array.isArray(formats) || !formats.length || tracks.has(languageCode)) continue
      // Manual tracks take precedence; VTT is requested independently at download time.
      const named = formats.find(format => typeof format?.name === 'string')
      tracks.set(languageCode, { languageCode, name: named?.name?.trim() || languageCode, isAutomatic: automatic })
    }
  }
  const subtitles = [...tracks.values()].sort((a, b) => Number(a.isAutomatic) - Number(b.isAutomatic) || a.name.localeCompare(b.name))
  if (subtitles.length) return { state: 'available', subtitles }
  return captionFailure(diagnostics, Object.hasOwn(info, 'subtitles') && Object.hasOwn(info, 'automatic_captions'))
}

export function captionFailure(error: unknown, confirmed = false): CaptionDiscovery {
  const code = youtubeErrorCode(error)
  if (code?.includes('RATE_LIMITED')) return { state: 'rate-limited', subtitles: [], errorCode: code }
  if (code === 'YOUTUBE_AUTH_REQUIRED' || code === 'YOUTUBE_PO_TOKEN_REQUIRED' || code === 'YOUTUBE_FORMATS_RESTRICTED'
    || /HTTP (?:Error )?403|Forbidden/i.test(getErrorText(error))) {
    return { state: 'restricted', subtitles: [], errorCode: code ?? undefined }
  }
  return { state: confirmed && !getErrorText(error) ? 'none-confirmed' : 'unknown', subtitles: [], errorCode: code ?? undefined }
}
