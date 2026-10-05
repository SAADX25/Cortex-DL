import type { HlsVariant, AnalyzeResult } from './types'

function isLikelyM3u8(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url)
}

function absolutize(baseUrl: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, baseUrl).toString()
  } catch {
    return maybeRelative
  }
}

function parseAttributes(line: string): Record<string, string> {
  const idx = line.indexOf(':')
  if (idx === -1) return {}
  const attrs = line.slice(idx + 1)
  const out: Record<string, string> = {}
  for (const part of attrs.split(',')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim().replace(/^"|"$/g, '')
    out[k] = v
  }
  return out
}

function parseResolution(value: string | undefined): { width: number; height: number } | null {
  if (!value) return null
  const match = /^(\d+)x(\d+)$/i.exec(value.trim())
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

export async function analyzeUrlForHls(inputUrl: string): Promise<AnalyzeResult> {
  if (!isLikelyM3u8(inputUrl)) return { kind: 'direct' }

  const res = await fetch(inputUrl, { redirect: 'follow' })
  if (!res.ok) return { kind: 'unknown' }
  const text = await res.text()

  const lines = text
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (!lines.some((l) => l.startsWith('#EXTM3U'))) return { kind: 'unknown' }

  const hasMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))
  if (!hasMaster) return { kind: 'hls-media', url: inputUrl }

  const variants: HlsVariant[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue
    const attrs = parseAttributes(line)
    const bandwidth = attrs['BANDWIDTH'] ? Number(attrs['BANDWIDTH']) : null
    const resolution = parseResolution(attrs['RESOLUTION'])
    const nextUrl = lines[i + 1]
    if (!nextUrl || nextUrl.startsWith('#')) continue
    variants.push({
      bandwidth: Number.isFinite(bandwidth) && (bandwidth as number) > 0 ? (bandwidth as number) : null,
      resolution,
      url: absolutize(inputUrl, nextUrl),
    })
  }

  variants.sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))
  return { kind: 'hls-master', variants }
}

