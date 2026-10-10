import { isYouTubeAuthRequiredError, isYouTubeUrl } from '../../Shared/youtubeErrors'

/** Public YouTube formats can be more complete than those exposed to a signed-in account. */
export async function withYouTubeCookieFallback<T>(
  url: string,
  cookies: string[],
  signal: AbortSignal | undefined,
  extract: (cookieArgs: string[]) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted()
  const publicFirst = isYouTubeUrl(url)
  try {
    return await extract([])
  } catch (error) {
    signal?.throwIfAborted()
    if (!publicFirst || !cookies.length || !isYouTubeAuthRequiredError(error)) throw error
    // One authenticated attempt, only for content that actually needs sign-in.
    return extract(cookies)
  }
}
