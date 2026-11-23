// Timecode parsing/formatting and timeline zoom viewport + ruler tick math for the visual trimmer.
export function clampSeconds(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

export function parseTimecode(value?: string | null): number | null {
  if (!value?.trim()) return null
  const trimmed = value.trim()
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(trimmed)) return null
  const parts = trimmed.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null
  // Allow raw seconds (e.g. "90"), but enforce <60 on trailing fields in MM:SS / HH:MM:SS.
  if (parts.length > 1 && parts.slice(1).some((part) => part >= 60)) return null
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

export function formatTimecode(totalSeconds: number, includeTenths = false): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0
  const rounded = includeTenths ? Math.round(safe * 10) / 10 : Math.floor(safe)
  const whole = Math.floor(rounded)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const seconds = whole % 60
  const base = [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
  ].join(':')
  if (!includeTenths) return base
  const tenths = Math.round((rounded - whole) * 10)
  return tenths > 0 ? `${base}.${tenths}` : base
}

export function formatCompactTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function formatClipBadge(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  return `${seconds}s`
}

export interface ZoomViewport {
  viewStart: number
  viewEnd: number
  viewDuration: number
}

export function computeZoomViewport(duration: number, zoom: number, viewStartInput: number): ZoomViewport {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  if (safeDuration <= 0) return { viewStart: 0, viewEnd: 0, viewDuration: 0 }
  const safeZoom = clampSeconds(zoom, 1, 64)
  const viewDuration = safeDuration / safeZoom
  const maxStart = Math.max(0, safeDuration - viewDuration)
  const viewStart = clampSeconds(viewStartInput, 0, maxStart)
  return { viewStart, viewEnd: viewStart + viewDuration, viewDuration }
}

export interface RulerTick {
  time: number
  percent: number
  label: string
  major: boolean
}

const NICE_INTERVALS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]

export function computeRulerTicks(viewStart: number, viewEnd: number, maxMajorTicks = 7): RulerTick[] {
  const span = viewEnd - viewStart
  if (!Number.isFinite(span) || span <= 0) return []
  // Snap spacing to clock-friendly intervals and use small epsilons to absorb float drift on tick boundaries.
  const rawStep = span / Math.max(2, maxMajorTicks)
  const majorStep = NICE_INTERVALS.find((step) => step >= rawStep) ?? Math.ceil(rawStep / 3600) * 3600
  const minorStep = majorStep >= 10 ? majorStep / 5 : majorStep >= 2 ? majorStep / 2 : majorStep

  const ticks: RulerTick[] = []
  const first = Math.ceil(viewStart / minorStep) * minorStep
  for (let t = first; t <= viewEnd + 1e-6; t += minorStep) {
    const time = Math.min(viewEnd, Math.max(viewStart, Math.round(t * 100) / 100))
    const percent = ((time - viewStart) / span) * 100
    const isMajor = Math.abs((time / majorStep) - Math.round(time / majorStep)) < 1e-3
    ticks.push({
      time,
      percent,
      label: isMajor ? formatCompactTime(time) : '',
      major: isMajor,
    })
  }
  return ticks
}
