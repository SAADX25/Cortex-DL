import type { Translations } from '../translations'
import type { CookieValidationResult } from '../../../Shared/types'

export function getCookieStatusText(t: Translations, validation: CookieValidationResult): string {
  switch (validation.code) {
    case 'valid': return t.youtube_cookie_valid
    case 'cleared': return t.youtube_cookie_cleared
    case 'missing': return t.youtube_cookie_missing
    case 'not_file': return t.youtube_cookie_not_file
    case 'invalid_header': return t.youtube_cookie_invalid_header
    case 'invalid_rows': return t.youtube_cookie_invalid_rows
    case 'expired': return t.youtube_cookie_expired
    case 'missing_youtube': return t.youtube_cookie_missing_youtube
    case 'read_error': return t.youtube_cookie_read_error
    case 'save_error': return t.youtube_cookie_save_error
    default: return validation.message
  }
}
