// Parses yt-dlp and FFmpeg stdout/stderr into structured download progress and phase transitions.
import { type DownloadTask } from './types'
import { parseTimeToSeconds } from './utils'
import log from 'electron-log'

export interface FfmpegState {
  totalDuration: number | null
  sectionStart?: number
  lastBytes?: number
  lastBytesAtMs?: number
  stderr: string
}

const RAW_PROGRESS_LOG_ENABLED = /^(1|true|yes)$/i.test(process.env.CORTEX_DL_DEBUG_PROGRESS ?? '')

export function logRawProgressChunk(taskId: string, source: string, chunk: string): void {
  if (!RAW_PROGRESS_LOG_ENABLED) return

  const lines = chunk
    .split(/\r\n|[\r\n]/)
    .map(line => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    log.info(`[progress:raw][${taskId}][${source}] ${line}`)
  }
}

export function parseDownloadProgress(line: string, task: DownloadTask): boolean {
  let changed = false

  // Custom --progress-template format emitted by YoutubeEngine; preferred over yt-dlp's default text output.
  const tplMatch = /CORTEX_DL\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|\s]+)/.exec(line)
  if (tplMatch) {
    const [, formatId, filename, downloadedText, totalText, speedText] = tplMatch
    const downloaded = Number(downloadedText)
    const total = Number(totalText)
    const speed = Number(speedText)
    if (!Number.isFinite(downloaded) || downloaded < 0) return false

    const key = `${formatId}|${filename}`
    const streams = task.ytdlpStreams ?? (task.ytdlpStreams = {})
    const previous = streams[key]
    streams[key] = {
      downloaded: Math.max(previous?.downloaded ?? 0, Math.round(downloaded)),
      total:
        Number.isFinite(total) && total > 0
          ? Math.max(previous?.total ?? 0, Math.round(total))
          : (previous?.total ?? null),
    }
    const values = Object.values(streams)
    task.downloadedBytes = values.reduce((sum, stream) => sum + stream.downloaded, 0)
    const observedTotal = values.reduce((sum, stream) => sum + (stream.total ?? 0), 0)
    const expected = task.ytdlpExpectedBytes ?? 0
    const allObserved =
      task.ytdlpExpectedStreamCount &&
      values.length >= task.ytdlpExpectedStreamCount &&
      values.every(stream => stream.total !== null)
    task.totalBytes = allObserved
      ? observedTotal
      : expected > 0
        ? Math.max(expected, observedTotal)
        : values.every(stream => stream.total !== null)
          ? observedTotal || null
          : null
    if (task.totalBytes) {
      task.downloadPercent = Math.min(
        100,
        Math.round((task.downloadedBytes / task.totalBytes) * 100),
      )
    } else if (task.phase !== 'trimming') {
      task.downloadPercent = undefined
    }
    if (Number.isFinite(speed) && speed >= 0) task.speedBytesPerSec = Math.round(speed)
    return true
  }

  // Once structured stream tracking is active, ignore legacy [download] lines so totals don't jitter.
  if (task.engine === 'ytdlp' && task.ytdlpStreams && Object.keys(task.ytdlpStreams).length)
    return false

  const progressMatch =
    /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|B)/i.exec(line)
  if (progressMatch) {
    const totalVal = parseFloat(progressMatch[2])
    const unit = progressMatch[3].toLowerCase()
    const multiplier =
      unit === 'kib'
        ? 1024
        : unit === 'mib'
          ? 1024 ** 2
          : unit === 'gib'
            ? 1024 ** 3
            : unit === 'tib'
              ? 1024 ** 4
              : 1
    const calculatedTotal = Math.round(totalVal * multiplier)
    if (calculatedTotal > 0 && calculatedTotal !== task.totalBytes) {
      task.totalBytes = calculatedTotal
      changed = true
    }
  }

  const percentMatch = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line)
  if (percentMatch) {
    const percent = parseFloat(percentMatch[1])
    if (!isNaN(percent) && task.totalBytes && task.totalBytes > 0) {
      task.downloadedBytes = Math.round((task.totalBytes * percent) / 100)
      task.downloadPercent = Math.min(100, Math.round(percent))
      changed = true
    }
  }

  const speedMatch = /at\s+(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|B)\/s/i.exec(line)
  if (speedMatch) {
    const speedVal = parseFloat(speedMatch[1])
    const sUnit = speedMatch[2].toLowerCase()
    const multiplier =
      sUnit === 'kib' ? 1024 : sUnit === 'mib' ? 1024 ** 2 : sUnit === 'gib' ? 1024 ** 3 : 1
    task.speedBytesPerSec = Math.round(speedVal * multiplier)
    changed = true
  }

  return changed
}

export function parseFfmpegProgress(line: string, task: DownloadTask, state: FfmpegState): boolean {
  let changed = false

  if (state.totalDuration === null) {
    const durMatch = /Duration:\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(line)
    if (durMatch) {
      const fullDuration = parseTimeToSeconds(durMatch[1])
      state.totalDuration =
        state.sectionStart && fullDuration > state.sectionStart
          ? Math.max(0.1, fullDuration - state.sectionStart)
          : fullDuration
    }
  }

  // Parse live output size and transfer rate emitted by FFmpeg during section/stream downloads.
  if (task.status === 'downloading') {
    const sizeMatch = /\bL?size=\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|kB|MB|GB|B)\b/i.exec(line)
    if (sizeMatch) {
      const value = parseFloat(sizeMatch[1])
      const unit = sizeMatch[2].toLowerCase()
      const multiplier =
        unit === 'kib' || unit === 'kb'
          ? 1024
          : unit === 'mib' || unit === 'mb'
            ? 1024 ** 2
            : unit === 'gib' || unit === 'gb'
              ? 1024 ** 3
              : 1
      const bytes = Math.round(value * multiplier)
      if (Number.isFinite(bytes) && bytes > task.downloadedBytes) {
        const now = Date.now()
        if (state.lastBytes !== undefined && state.lastBytesAtMs !== undefined) {
          const elapsedSec = (now - state.lastBytesAtMs) / 1000
          const delta = bytes - state.lastBytes
          if (elapsedSec >= 0.25 && delta > 0) {
            task.speedBytesPerSec = Math.round(delta / elapsedSec)
            state.lastBytes = bytes
            state.lastBytesAtMs = now
          }
        } else {
          state.lastBytes = bytes
          state.lastBytesAtMs = now
        }
        task.downloadedBytes = bytes
        changed = true
      }
    }

    if (!task.speedBytesPerSec) {
      const bitrateMatch = /\bbitrate=\s*(\d+(?:\.\d+)?)\s*kbits\/s/i.exec(line)
      const speedMultMatch = /\bspeed=\s*(\d+(?:\.\d+)?)x/i.exec(line)
      if (bitrateMatch && speedMultMatch) {
        const bps = Math.round(
          ((parseFloat(bitrateMatch[1]) * 1000) / 8) * parseFloat(speedMultMatch[1]),
        )
        if (Number.isFinite(bps) && bps > 0) {
          task.speedBytesPerSec = bps
          changed = true
        }
      }
    }
  }

  const timeMatch = /\b(?:out_)?time=(-?\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(line)
  // FFmpeg reports out_time_ms in microseconds despite the key name; both keys divide by 1e6.
  const outTimeUnitsMatch = /^out_time_(?:ms|us)=(\d+)$/.exec(line.trim())
  if (timeMatch || outTimeUnitsMatch) {
    const currentSec = timeMatch
      ? parseTimeToSeconds(timeMatch[1])
      : parseInt(outTimeUnitsMatch![1], 10) / 1_000_000
    if (currentSec <= 0) return changed

    const totalDuration = state.totalDuration

    if (totalDuration && totalDuration > 0) {
      const pct = Math.min(99, Math.max(1, Math.round((currentSec / totalDuration) * 100)))
      if (task.phase === 'trimming') {
        task.convertingPercent = pct
        task.downloadPercent = pct
        changed = true
      } else if (task.status === 'downloading') {
        task.downloadPercent = pct
        changed = true
      } else if (task.status === 'converting' || task.status === 'merging') {
        task.convertingPercent = pct
        changed = true
      }
    }
  }

  return changed
}

export interface TransitionResult {
  transitioned: boolean
  detectedPath: string | null
}

export function parseStateTransition(
  line: string,
  task: DownloadTask,
  state: FfmpegState,
  ctx: { sendUpdate: (task: DownloadTask) => void; saveState: () => void },
): TransitionResult {
  let detectedPath: string | null = null
  if (
    task.status === 'paused' ||
    task.status === 'canceled' ||
    task.status === 'error' ||
    task.status === 'completed'
  ) {
    return { transitioned: false, detectedPath }
  }

  const destMatch = /Destination:\s*(.+)$/.exec(line) ?? /Merging formats into "(.+)"/.exec(line)
  if (destMatch) {
    const possiblePath = destMatch[1].trim().replace(/^["']|["']$/g, '')
    if (possiblePath) detectedPath = possiblePath
  }

  const ppMatch = /CORTEX_PP:(.+)$/.exec(line)
  if (ppMatch) {
    const ppPath = ppMatch[1].trim()
    if (ppPath && ppPath !== 'NA') detectedPath = ppPath
  }

  if (line.includes('[Merger]') || line.includes('Merging formats')) {
    task.downloadPercent = 100
    task.status = 'merging'
    task.convertingPercent = undefined
    state.totalDuration = null
    const durMatch = /Duration:\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(state.stderr)
    if (durMatch) state.totalDuration = parseTimeToSeconds(durMatch[1])
    ctx.saveState()
    ctx.sendUpdate(task)
    return { transitioned: true, detectedPath }
  }

  if (
    line.includes('[VideoConvertor]') ||
    line.includes('[FFmpegVideoConvertor]') ||
    line.includes('[FFmpegVideoRemuxer]') ||
    line.includes('[ExtractAudio]') ||
    line.includes('[Postprocessor]') ||
    line.includes('[ModifyChapters]') ||
    line.includes('Converting video') ||
    line.includes('Converting to') ||
    /\[ffmpeg\].*converting/i.test(line) ||
    /Recoding video/i.test(line)
  ) {
    task.downloadPercent = 100
    task.status = 'converting'
    task.convertingPercent = undefined
    state.totalDuration = null
    const durMatch = /Duration:\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(state.stderr)
    if (durMatch) state.totalDuration = parseTimeToSeconds(durMatch[1])
    ctx.saveState()
    ctx.sendUpdate(task)
    return { transitioned: true, detectedPath }
  }

  return { transitioned: false, detectedPath }
}

// Split on CR as well as LF since yt-dlp and FFmpeg overwrite progress in-place with \r.
export function flushLines(buf: string, chunk: string): [string[], string] {
  buf += chunk

  const parts = buf.split(/\r\n|[\r\n]/)
  const remainder = parts.pop() || ''
  return [parts, remainder]
}
