export const YOUTUBE_AUTH_REQUIRED_CODE = 'YOUTUBE_AUTH_REQUIRED'
export const YOUTUBE_RATE_LIMITED_CODE = 'YOUTUBE_RATE_LIMITED'
export const YOUTUBE_SUBTITLE_RATE_LIMITED_CODE = 'YOUTUBE_SUBTITLE_RATE_LIMITED'
export const YOUTUBE_SUBTITLE_UNAVAILABLE_CODE = 'YOUTUBE_SUBTITLE_UNAVAILABLE'
export const YOUTUBE_FORMATS_RESTRICTED_CODE = 'YOUTUBE_FORMATS_RESTRICTED'
export const YOUTUBE_PO_TOKEN_REQUIRED_CODE = 'YOUTUBE_PO_TOKEN_REQUIRED'
export const YOUTUBE_NETWORK_ERROR_CODE = 'YOUTUBE_NETWORK_ERROR'

export function getErrorText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    const cause = 'cause' in value ? getErrorText(value.cause) : ''
    return [value.name, value.message, cause].filter(Boolean).join('\n')
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return ['code', 'message', 'stderr', 'stdout']
      .map(key => record[key]).filter((item): item is string => typeof item === 'string').join('\n')
  }
  return String(value ?? '')
}

export function youtubeErrorCode(value: unknown): string | null {
  const text = getErrorText(value)
  if (/YOUTUBE_SUBTITLE_UNAVAILABLE/i.test(text)) return YOUTUBE_SUBTITLE_UNAVAILABLE_CODE
  // A 429 can include generic sign-in advice. It is not a video authentication failure.
  if (/YOUTUBE_SUBTITLE_RATE_LIMITED/i.test(text)) return YOUTUBE_SUBTITLE_RATE_LIMITED_CODE
  if (/YOUTUBE_RATE_LIMITED|HTTP (?:Error )?429|too many requests|rate[-_\s]?limit(?:ed|ing)?|requests?[^\r\n]{0,40}limit exceeded|temporarily blocked[^\r\n]{0,40}(?:request|traffic|youtube)/i.test(text)) {
    return /Unable to download (?:video )?subtitles?|subtitles?[^\r\n]*HTTP (?:Error )?429/i.test(text)
      ? YOUTUBE_SUBTITLE_RATE_LIMITED_CODE : YOUTUBE_RATE_LIMITED_CODE
  }
  if (/YOUTUBE_NETWORK_ERROR|Failed to resolve|Name or service not known|Temporary failure in name resolution|Connection (?:reset|refused)|network is unreachable|timed out|TLS|SSL:|certificate verify failed/i.test(text)) return YOUTUBE_NETWORK_ERROR_CODE
  if (/YOUTUBE_AUTH_REQUIRED|sign in to confirm|not a bot|LOGIN_REQUIRED|age[- ]restricted|login required|members.only|private video/i.test(text)) return YOUTUBE_AUTH_REQUIRED_CODE
  if (/YOUTUBE_PO_TOKEN_REQUIRED|(?:PO|proof.of.origin) token[^\r\n]*(?:required|not provided|missing)|require[^\r\n]*(?:PO|proof.of.origin) token/i.test(text)) return YOUTUBE_PO_TOKEN_REQUIRED_CODE
  if (/YOUTUBE_FORMATS_RESTRICTED|formats have been skipped|only images are available|requested format is not available|DRM protected/i.test(text)) return YOUTUBE_FORMATS_RESTRICTED_CODE
  if (/Unable to download (?:video )?subtitles?[^\r\n]*HTTP (?:Error )?403/i.test(text)) return YOUTUBE_SUBTITLE_UNAVAILABLE_CODE
  return null
}

export function isYouTubeAuthRequiredError(value: unknown): boolean {
  return youtubeErrorCode(value) === YOUTUBE_AUTH_REQUIRED_CODE
}

export function isYouTubeUrl(input: string): boolean {
  try {
    const { hostname, protocol } = new URL(input)
    return ['http:', 'https:'].includes(protocol)
      && (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com'))
  } catch { return false }
}
