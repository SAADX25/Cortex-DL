// URL matching and canonicalization for Kick, Threads, and YouTube before analysis.
const KICK_HOSTS = new Set(['kick.com', 'www.kick.com', 'm.kick.com', 'player.kick.com'])

export function isKickUrl(input: string): boolean {
  try {
    const url = new URL(input.trim())
    return ['https:', 'http:'].includes(url.protocol) && KICK_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

const THREADS_HOSTS = new Set([
  'threads.com',
  'www.threads.com',
  'm.threads.com',
  'threads.net',
  'www.threads.net',
  'm.threads.net',
])

export function isThreadsUrl(input: string): boolean {
  try {
    const url = new URL(input.trim())
    return (
      ['https:', 'http:'].includes(url.protocol) && THREADS_HOSTS.has(url.hostname.toLowerCase())
    )
  } catch {
    return false
  }
}

export function threadsPostCode(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      !THREADS_HOSTS.has(url.hostname.toLowerCase())
    )
      return null
    const path = url.pathname.replace(/\/+$/, '')
    // Threads posts use /@user/post/<code>, /t/<code>, or /post/<code>.
    const match =
      /^\/@[^/]+\/post\/([A-Za-z0-9_-]+)(?:\/media)?$/i.exec(path) ??
      /^\/t\/([A-Za-z0-9_-]+)$/i.exec(path) ??
      /^\/post\/([A-Za-z0-9_-]+)(?:\/media)?$/i.exec(path)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export function threadsCarouselIndex(input: string): number | null {
  try {
    const url = new URL(input.trim())
    if (!isThreadsUrl(input)) return null
    const raw = url.searchParams.get('carousel')
    if (raw === null || !/^\d+$/.test(raw)) return null
    const index = Number(raw)
    return Number.isSafeInteger(index) && index >= 0 && index < 100 ? index : null
  } catch {
    return null
  }
}

export function youtubeVideoId(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (!['https:', 'http:'].includes(url.protocol)) return null
    let id: string | null = null
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1).split('/')[0]
    else if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(
        url.hostname,
      )
    ) {
      if (url.pathname === '/watch') id = url.searchParams.get('v')
      else id = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
  } catch {
    return null
  }
}

export function normalizeAnalysisUrl(input: string): string {
  const url = new URL(input.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid URL protocol')
  const id = youtubeVideoId(input)

  // Only strip tracking params on single-video URLs; keep playlist/radio queries intact.
  const safe = ['v', 'si', 't', 'start', 'feature', 'app']
  if (id && Array.from(url.searchParams.keys()).every(key => safe.includes(key))) {
    return `https://www.youtube.com/watch?v=${id}`
  }

  // Canonicalize threads.net and /media variants to threads.com so cache keys match.
  if (THREADS_HOSTS.has(url.hostname.toLowerCase())) {
    const code = threadsPostCode(input)
    if (code) {
      const userMatch = /^\/(@[^/]+)\/post\/[A-Za-z0-9_-]+(?:\/media)?\/?$/i.exec(url.pathname)
      const canonicalPath = userMatch ? `/${userMatch[1]}/post/${code}` : `/t/${code}`
      const carousel = threadsCarouselIndex(input)
      return carousel !== null
        ? `https://www.threads.com${canonicalPath}?carousel=${carousel}`
        : `https://www.threads.com${canonicalPath}`
    }
  }

  return url.toString()
}
