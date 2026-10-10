/** FFprobe exposes frame rates as rational strings, including invalid 0/0. */
export function parseFrameRate(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const text = String(value).trim()
  const parts = text.split('/')
  if (parts.length > 2 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return null
  const rate = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(parts[0])
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

export function videoFrameRate(streams: Array<{
  codec_type?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  disposition?: { attached_pic?: number }
}>): number | null {
  const video = streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
  return video ? parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate) : null
}
