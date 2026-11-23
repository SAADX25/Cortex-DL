// Engine routing heuristics and user-facing IPC error normalization for YouTube, Threads, and Electron.
import { getErrorText, youtubeErrorCode, YOUTUBE_AUTH_REQUIRED_CODE, YOUTUBE_RATE_LIMITED_CODE, YOUTUBE_BOT_VERIFICATION_CODE } from '../../../Shared/youtubeErrors'
import { threadsErrorCode, THREADS_NO_MEDIA_CODE, THREADS_POST_UNAVAILABLE_CODE, THREADS_INVALID_URL_CODE } from '../../../Shared/threadsErrors'
import { type Translations } from '../translations'

export function isYtdlpUrl(url: string): boolean {
  const lowUrl = url.toLowerCase()
  if (
    lowUrl.includes('youtube.com') ||
    lowUrl.includes('youtu.be') ||
    lowUrl.includes('facebook.com') ||
    lowUrl.includes('fb.watch') ||
    lowUrl.includes('instagram.com') ||
    lowUrl.includes('threads.com') ||
    lowUrl.includes('threads.net') ||
    lowUrl.includes('kick.com') ||
    lowUrl.includes('twitch.tv') ||
    lowUrl.includes('reddit.com') ||
    lowUrl.includes('tiktok.com') ||
    lowUrl.includes('twitter.com') ||
    lowUrl.includes('x.com') ||
    lowUrl.includes('vimeo.com') ||
    lowUrl.includes('dailymotion.com')
  ) {
    return true
  }

  // Direct media links bypass yt-dlp; unknown webpage URLs default to yt-dlp extractors.
  if (/\.(mp4|mp3|m4a|webm|mkv|avi|m3u8)(\?|#|$)/i.test(lowUrl)) {
    return false
  }
  return true
}

type ProviderMessages = Pick<
  Translations,
  | 'youtube_auth_required'
  | 'youtube_rate_limited'
  | 'youtube_bot_verification'
  | 'download_retry_required'
  | 'youtube_formats_restricted'
  | 'youtube_po_token_required'
  | 'youtube_network_error'
  | 'threads_no_media'
  | 'threads_post_unavailable'
  | 'threads_invalid_url'
>

export function youtubeErrorMessage(error: unknown, messages: Pick<ProviderMessages, 'youtube_auth_required' | 'youtube_rate_limited' | 'youtube_bot_verification' | 'youtube_formats_restricted' | 'youtube_po_token_required' | 'youtube_network_error'>): string | null {
  switch (youtubeErrorCode(error)) {
    case YOUTUBE_AUTH_REQUIRED_CODE: return messages.youtube_auth_required
    case YOUTUBE_RATE_LIMITED_CODE: return messages.youtube_rate_limited
    case YOUTUBE_BOT_VERIFICATION_CODE: return messages.youtube_bot_verification
    case 'YOUTUBE_FORMATS_RESTRICTED': return messages.youtube_formats_restricted
    case 'YOUTUBE_PO_TOKEN_REQUIRED': return messages.youtube_po_token_required
    case 'YOUTUBE_NETWORK_ERROR': return messages.youtube_network_error
    default: return null
  }
}

export function threadsErrorMessage(error: unknown, messages: Pick<ProviderMessages, 'threads_no_media' | 'threads_post_unavailable' | 'threads_invalid_url'>): string | null {
  switch (threadsErrorCode(error)) {
    case THREADS_NO_MEDIA_CODE: return messages.threads_no_media
    case THREADS_POST_UNAVAILABLE_CODE: return messages.threads_post_unavailable
    case THREADS_INVALID_URL_CODE: return messages.threads_invalid_url
    default: return null
  }
}

export function normalizeIpcError(error: unknown, fallback: string, messages: ProviderMessages): string {
  const rawMessage = getErrorText(error)
  if (rawMessage.includes('DOWNLOAD_RETRY_REQUIRED')) return messages.download_retry_required
  const youtubeMessage = youtubeErrorMessage(error, messages)
  if (youtubeMessage) return youtubeMessage
  const threadsMessage = threadsErrorMessage(error, messages)
  if (threadsMessage) return threadsMessage

  // Strip Electron's IPC wrapper prefix so the UI displays the underlying reason.
  const cleaned = rawMessage
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^(?:Error|YouTubeAuthRequiredError):\s*/i, '')
    .trim()

  if (!cleaned || /Error invoking remote method/i.test(cleaned)) return fallback
  return cleaned
}
