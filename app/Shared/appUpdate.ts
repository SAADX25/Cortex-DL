// Shared app auto-update state contract, release-note sanitization, and error classification.
export const APP_UPDATE_CHANNEL = 'update-status'

export type AppUpdatePhase =
  'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'

export type AppUpdateErrorCode =
  'offline' | 'not-published' | 'integrity' | 'download' | 'unsupported' | 'unknown'

export interface AppUpdateProgress {
  percent: number
  transferredBytes: number
  totalBytes: number
  bytesPerSecond: number
  etaSeconds: number | null
}

export interface AppUpdateState {
  phase: AppUpdatePhase
  currentVersion: string
  latestVersion: string | null
  releaseName: string | null
  releaseDate: string | null
  releaseNotes: string[]
  totalSizeBytes: number | null
  progress: AppUpdateProgress | null
  errorCode: AppUpdateErrorCode | null
  errorDetail: string | null
  checkedAtMs: number | null
  canCancel: boolean
  manualCheck: boolean
}

export function initialAppUpdateState(currentVersion: string): AppUpdateState {
  return {
    phase: 'idle',
    currentVersion,
    latestVersion: null,
    releaseName: null,
    releaseDate: null,
    releaseNotes: [],
    totalSizeBytes: null,
    progress: null,
    errorCode: null,
    errorDetail: null,
    checkedAtMs: null,
    canCancel: false,
    manualCheck: false,
  }
}

const MAX_RELEASE_NOTE_LINES = 10
const MAX_RELEASE_NOTE_LENGTH = 220

function decodeBasicEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number(dec)
      return Number.isFinite(code) && code >= 32 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : ' '
    })
}

function normalizeReleaseText(raw: string): string[] {
  const withoutBlocks = raw.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '\n')
  const withBreaks = withoutBlocks
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(?:p|div|li|h[1-6]|tr|ul|ol)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')

  const decoded = decodeBasicEntities(withBreaks)
  const lines: string[] = []
  const seen = new Set<string>()

  for (const rawLine of decoded.split(/\r?\n/)) {
    const cleaned = rawLine
      .replace(/^[\s•*\-–—]+/, '')
      .replace(/^#+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!cleaned || /^no content\.?$/i.test(cleaned)) continue
    if (/^full changelog\s*:/i.test(cleaned)) continue

    const truncated =
      cleaned.length > MAX_RELEASE_NOTE_LENGTH
        ? `${cleaned.slice(0, MAX_RELEASE_NOTE_LENGTH - 1).trimEnd()}…`
        : cleaned
    const dedupeKey = truncated.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    lines.push(truncated)
    if (lines.length >= MAX_RELEASE_NOTE_LINES) break
  }

  return lines
}

export function parseReleaseNotes(raw: unknown): string[] {
  if (!raw) return []
  if (typeof raw === 'string') return normalizeReleaseText(raw)
  if (Array.isArray(raw)) {
    const collected: string[] = []
    for (const entry of raw) {
      if (typeof entry === 'string') {
        collected.push(...normalizeReleaseText(entry))
      } else if (
        entry &&
        typeof entry === 'object' &&
        'note' in entry &&
        typeof (entry as { note?: unknown }).note === 'string'
      ) {
        collected.push(...normalizeReleaseText((entry as { note: string }).note))
      }
      if (collected.length >= MAX_RELEASE_NOTE_LINES) break
    }
    return collected.slice(0, MAX_RELEASE_NOTE_LINES)
  }
  return []
}

export function extractUpdateSize(files: unknown): number | null {
  if (!Array.isArray(files)) return null
  for (const item of files) {
    if (item && typeof item === 'object' && 'size' in item) {
      const size = Number((item as { size?: unknown }).size)
      if (Number.isFinite(size) && size > 0) return size
    }
  }
  return null
}

export function computeUpdateEta(
  transferredBytes: number,
  totalBytes: number,
  bytesPerSecond: number,
): number | null {
  if (
    !Number.isFinite(transferredBytes) ||
    !Number.isFinite(totalBytes) ||
    !Number.isFinite(bytesPerSecond)
  ) {
    return null
  }
  if (bytesPerSecond <= 0 || totalBytes <= 0 || transferredBytes >= totalBytes) {
    return null
  }
  const remaining = totalBytes - transferredBytes
  const seconds = Math.ceil(remaining / bytesPerSecond)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) return null
  return seconds
}

export function createProgressSnapshot(
  raw:
    | { percent?: number; transferred?: number; total?: number; bytesPerSecond?: number }
    | null
    | undefined,
  fallbackTotalBytes: number | null,
): AppUpdateProgress {
  const totalBytes = Math.max(0, Number(raw?.total) || fallbackTotalBytes || 0)
  const transferredBytes = Math.max(0, Number(raw?.transferred) || 0)
  const bytesPerSecond = Math.max(0, Number(raw?.bytesPerSecond) || 0)
  const rawPercent = Number(raw?.percent)
  const computedPercent = Number.isFinite(rawPercent)
    ? rawPercent
    : totalBytes > 0
      ? (transferredBytes / totalBytes) * 100
      : 0
  const percent = Math.min(100, Math.max(0, computedPercent))

  return {
    percent,
    transferredBytes,
    totalBytes,
    bytesPerSecond,
    etaSeconds: computeUpdateEta(transferredBytes, totalBytes, bytesPerSecond),
  }
}

export function isCancellationError(error: unknown): boolean {
  if (!error) return false
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /\bcancell?ed\b|ERR_UPDATER_CANCELLED|CancellationError/i.test(text)
}

function sanitizeErrorDetail(raw: string): string {
  return raw
    .replace(/https?:\/\/[^\s"'<>)]+/gi, '')
    .replace(/\bHeaders:\s*\{[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

export function classifyUpdateError(error: unknown): { code: AppUpdateErrorCode; detail: string } {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const detail = sanitizeErrorDetail(raw)

  if (
    /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|offline/i.test(
      raw,
    )
  ) {
    return { code: 'offline', detail }
  }
  if (
    /Cannot find latest\.yml|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|ERR_UPDATER_LATEST_VERSION_NOT_FOUND|No published versions|HttpError:\s*404/i.test(
      raw,
    )
  ) {
    return { code: 'not-published', detail }
  }
  if (/sha512|checksum|signature|ERR_UPDATER_INVALID_SIGNATURE/i.test(raw)) {
    return { code: 'integrity', detail }
  }
  if (/not packaged|development|app-update\.yml|ENOENT/i.test(raw)) {
    return { code: 'unsupported', detail }
  }
  if (/download|EPIPE|ENOSPC|EPERM|EACCES|HttpError:\s*5\d\d/i.test(raw)) {
    return { code: 'download', detail }
  }
  return { code: 'unknown', detail }
}
