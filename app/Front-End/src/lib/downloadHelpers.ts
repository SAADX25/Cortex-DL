import { getErrorText, youtubeErrorCode, YOUTUBE_AUTH_REQUIRED_CODE, YOUTUBE_RATE_LIMITED_CODE, YOUTUBE_SUBTITLE_RATE_LIMITED_CODE, YOUTUBE_SUBTITLE_UNAVAILABLE_CODE } from '../../../Shared/youtubeErrors'
import type { Translations } from '../translations'

export function isYtdlpUrl(url: string): boolean {
  const lowUrl = url.toLowerCase()
  if (
    lowUrl.includes('youtube.com') ||
    lowUrl.includes('youtu.be') ||
    lowUrl.includes('facebook.com') ||
    lowUrl.includes('fb.watch') ||
    lowUrl.includes('instagram.com') ||
    lowUrl.includes('tiktok.com') ||
    lowUrl.includes('twitter.com') ||
    lowUrl.includes('x.com') ||
    lowUrl.includes('vimeo.com') ||
    lowUrl.includes('dailymotion.com')
  ) {
    return true
  }

  if (/\.(mp4|mp3|m4a|webm|mkv|avi|m3u8)(\?|#|$)/i.test(lowUrl)) {
    return false
  }
  return true
}

export const SUBTITLE_EMBED_FORMATS = new Set<TargetFormat>(['mp4', 'mkv', 'webm'])

type YouTubeMessages = Pick<Translations, 'youtube_auth_required' | 'youtube_rate_limited' | 'youtube_subtitle_rate_limited' | 'youtube_subtitle_unavailable'>

export function youtubeErrorMessage(error: unknown, messages: YouTubeMessages): string | null {
  switch (youtubeErrorCode(error)) {
    case YOUTUBE_AUTH_REQUIRED_CODE: return messages.youtube_auth_required
    case YOUTUBE_RATE_LIMITED_CODE: return messages.youtube_rate_limited
    case YOUTUBE_SUBTITLE_RATE_LIMITED_CODE: return messages.youtube_subtitle_rate_limited
    case YOUTUBE_SUBTITLE_UNAVAILABLE_CODE: return messages.youtube_subtitle_unavailable
    default: return null
  }
}

export function normalizeIpcError(error: unknown, fallback: string, messages: YouTubeMessages): string {
  const rawMessage = getErrorText(error)
  const youtubeMessage = youtubeErrorMessage(error, messages)
  if (youtubeMessage) return youtubeMessage

  const cleaned = rawMessage
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^(?:Error|YouTubeAuthRequiredError):\s*/i, '')
    .trim()

  if (!cleaned || /Error invoking remote method/i.test(cleaned)) return fallback
  return cleaned
}
