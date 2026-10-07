export const YOUTUBE_AUTH_REQUIRED_CODE = 'YOUTUBE_AUTH_REQUIRED'
export const YOUTUBE_RATE_LIMITED_CODE = 'YOUTUBE_RATE_LIMITED'
export const YOUTUBE_SUBTITLE_RATE_LIMITED_CODE = 'YOUTUBE_SUBTITLE_RATE_LIMITED'

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
  // A 429 can include generic sign-in advice. It must never trigger a cookies retry.
  if (/YOUTUBE_SUBTITLE_RATE_LIMITED/i.test(text)) return YOUTUBE_SUBTITLE_RATE_LIMITED_CODE
  if (/YOUTUBE_RATE_LIMITED|HTTP (?:Error )?429|too many requests|rate[-_\s]?limit(?:ed|ing)?|requests?[^\r\n]{0,40}limit exceeded|temporarily blocked[^\r\n]{0,40}(?:request|traffic|youtube)/i.test(text)) {
    return /Unable to download (?:video )?subtitles?|subtitles?[^\r\n]*HTTP (?:Error )?429/i.test(text)
      ? YOUTUBE_SUBTITLE_RATE_LIMITED_CODE : YOUTUBE_RATE_LIMITED_CODE
  }
  return /YOUTUBE_AUTH_REQUIRED|sign in to confirm|not a bot|use --cookies-from-browser or --cookies|LOGIN_REQUIRED|age[- ]restricted/i.test(text)
    ? YOUTUBE_AUTH_REQUIRED_CODE : null
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
