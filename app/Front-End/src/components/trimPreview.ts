export function logPreviewFailure(reason: string): void {
  console.error('[Visual Trim]', reason)
  if (typeof window !== 'undefined') window.cortexDl?.logPreviewError?.(reason)
}

export function validatePreviewUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid preview stream URL')
  const expires = Number(url.searchParams.get('expire') || url.searchParams.get('expires'))
  if (expires > 0 && expires * 1000 <= Date.now()) throw new Error('Expired preview stream URL; analyze the source again')
  return url.href
}

export function videoFailure(video: HTMLVideoElement): string {
  const reasons: Record<number, string> = {
    1: 'Video preview load aborted',
    2: 'Video preview network failure (stream may have expired or access was denied)',
    3: 'Video preview decoding failed: unsupported codec or corrupt media',
    4: 'Video preview source unavailable: unsupported codec/container or inaccessible stream',
  }
  return `${reasons[video.error?.code ?? 0] ?? 'Unknown video preview failure'}${video.error?.message ? `: ${video.error.message}` : ''}`
}

/** One extraction and at most one analyzed fallback, including playback errors. */
export class TrimPreview {
  private disposed = false
  private fallbackUsed = false
  private activeUrl: string | null = null
  constructor(
    private readonly fallback: string,
    private readonly update: (url: string | null, error: string | null, loading: boolean) => void,
  ) {}

  async start(extract?: () => Promise<string>): Promise<void> {
    this.update(null, null, Boolean(extract))
    if (!extract) {
      this.fallbackUsed = true
      try {
        this.activeUrl = validatePreviewUrl(this.fallback)
        this.update(this.activeUrl, null, false)
      } catch (error) { this.fail(`Invalid fallback preview: ${String(error)}`) }
      return
    }
    try {
      const url = validatePreviewUrl(await extract())
      if (!this.disposed) { this.activeUrl = url; this.update(url, null, false) }
    } catch (error) {
      if (!this.disposed) this.fail(`yt-dlp preview extraction failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  fail(reason: string): void {
    if (this.disposed) return
    logPreviewFailure(reason)
    if (!this.fallbackUsed && this.fallback) {
      this.fallbackUsed = true
      try {
        const url = validatePreviewUrl(this.fallback)
        if (url !== this.activeUrl) { this.activeUrl = url; this.update(url, null, false); return }
      } catch (error) { reason += `; fallback: ${String(error)}`; logPreviewFailure(reason) }
    }
    this.activeUrl = null
    this.update(null, reason, false)
  }

  dispose(): void { this.disposed = true }
}

export function seekPreview(video: HTMLMediaElement | null, seconds: number): boolean {
  if (!video || video.readyState < 1) return false
  try {
    video.currentTime = Number.isFinite(video.duration) ? Math.min(seconds, video.duration) : seconds
    return true
  } catch (error) { console.error('[Visual Trim] Seek failed:', error); return false }
}
