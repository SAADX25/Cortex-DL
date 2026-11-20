import { getErrorText } from './youtubeErrors'

export const THREADS_NO_MEDIA_CODE = 'THREADS_NO_MEDIA'
export const THREADS_POST_UNAVAILABLE_CODE = 'THREADS_POST_UNAVAILABLE'
export const THREADS_INVALID_URL_CODE = 'THREADS_INVALID_URL'

export function threadsErrorCode(value: unknown): string | null {
  const text = getErrorText(value)
  if (text.includes(THREADS_NO_MEDIA_CODE)) return THREADS_NO_MEDIA_CODE
  if (text.includes(THREADS_POST_UNAVAILABLE_CODE)) return THREADS_POST_UNAVAILABLE_CODE
  if (text.includes(THREADS_INVALID_URL_CODE)) return THREADS_INVALID_URL_CODE
  return null
}
