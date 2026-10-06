export function parseMediaRange(header: string, size: number): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2]) || size <= 0) return null
  const suffix = Number(match[2])
  if (!match[1] && (!Number.isSafeInteger(suffix) || suffix <= 0)) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - suffix)
  const requestedEnd = match[1] && match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) return null
  return [start, Math.min(requestedEnd, size - 1)]
}
