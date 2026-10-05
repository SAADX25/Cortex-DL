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

const YOUTUBE_AUTH_ERROR_PATTERN =
  /YOUTUBE_AUTH_REQUIRED|sign in to confirm|not a bot|use --cookies-from-browser or --cookies|LOGIN_REQUIRED|age[- ]restricted|HTTP Error 429|too many requests|rate[-_\s]?limit/i

export const SUBTITLE_EMBED_FORMATS = new Set<TargetFormat>(['mp4', 'mkv', 'webm'])

export function normalizeIpcError(error: unknown, fallback: string, youtubeAuthMessage: string): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  if (YOUTUBE_AUTH_ERROR_PATTERN.test(rawMessage)) return youtubeAuthMessage

  const cleaned = rawMessage
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^(?:Error|YouTubeAuthRequiredError):\s*/i, '')
    .trim()

  if (!cleaned || /Error invoking remote method/i.test(cleaned)) return fallback
  return cleaned
}
