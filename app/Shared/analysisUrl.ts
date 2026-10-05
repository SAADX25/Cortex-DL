/** Preserve query strings on arbitrary providers: they may carry identity/authentication. */
export function youtubeVideoId(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (!['https:', 'http:'].includes(url.protocol)) return null
    let id: string | null = null
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1).split('/')[0]
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v')
      else id = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
  } catch { return null }
}

export function normalizeAnalysisUrl(input: string): string {
  const url = new URL(input.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid URL protocol')
  const id = youtubeVideoId(input)
  // Canonicalize only unambiguous video links with known presentation parameters.
  const safe = ['v', 'si', 't', 'start', 'feature', 'app']
  if (id && Array.from(url.searchParams.keys()).every(key => safe.includes(key))) {
    return `https://www.youtube.com/watch?v=${id}`
  }
  return url.toString()
}
