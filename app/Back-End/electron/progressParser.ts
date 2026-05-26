/**
 *  Progress Parser — Extracts download progress from yt-dlp & FFmpeg output.
 *
 *  Handles both structured --progress-template output (machine-parseable)
 *  and classic regex fallback for older yt-dlp versions.
 *
 *  Dual-stream parsing: progress can arrive on EITHER stdout or stderr
 *  depending on yt-dlp version and configuration.
 */
import type { DownloadTask } from './types'
import { parseTimeToSeconds } from './utils'
import log from 'electron-log'

// ── FFmpeg State (shared across lines within one download) ───────────────────

export interface FfmpegState {
  totalDuration: number | null
  stderr: string
}

const RAW_PROGRESS_LOG_ENABLED = /^(1|true|yes)$/i.test(process.env.CORTEX_DL_DEBUG_PROGRESS ?? '')

/**
 * Diagnostic helper for yt-dlp / FFmpeg stream output.
 * Enable with CORTEX_DL_DEBUG_PROGRESS=1 to capture the raw dialect emitted by
 * trim jobs without spamming normal production logs.
 */
export function logRawProgressChunk(taskId: string, source: string, chunk: string): void {
  if (!RAW_PROGRESS_LOG_ENABLED) return

  const lines = chunk
    .split(/\r\n|[\r\n]/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    log.info(`[progress:raw][${taskId}][${source}] ${line}`)
  }
}

// ── Download Progress (yt-dlp structured + regex fallback) ───────────────────

/** Parse a single yt-dlp output line for download progress. Returns true if task was updated. */
export function parseDownloadProgress(line: string, task: DownloadTask): boolean {
  let changed = false

  // PRIMARY: Structured --progress-template output
  // Format: CORTEX_DL:<downloaded_bytes>:<total_bytes_estimate>:<speed>
  const tplMatch = /CORTEX_DL:(\S+):(\S+):(\S+)/.exec(line)
  if (tplMatch) {
    const dlBytes = parseFloat(tplMatch[1])
    const totalEst = parseFloat(tplMatch[2])
    const speed = parseFloat(tplMatch[3])

    if (!isNaN(dlBytes) && dlBytes >= 0) {
      task.downloadedBytes = Math.round(dlBytes)
      changed = true
    }
    if (!isNaN(totalEst) && totalEst > 0) {
      if (task.totalBytes !== Math.round(totalEst)) {
        task.totalBytes = Math.round(totalEst)
        changed = true
      }
    }
    if (!isNaN(speed) && speed >= 0) {
      const roundedSpeed = Math.round(speed)
      if (task.speedBytesPerSec !== roundedSpeed) {
        task.speedBytesPerSec = roundedSpeed
        changed = true
      }
    }

    if (task.totalBytes && task.totalBytes > 0 && task.downloadedBytes > 0) {
      task.downloadPercent = Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100))
    } else if (!isNaN(dlBytes) && !isNaN(totalEst) && totalEst > 0) {
      task.downloadPercent = Math.min(100, Math.round((dlBytes / totalEst) * 100))
    }
    return changed
  }

  // FALLBACK: Classic [download] regex for older yt-dlp
  const progressMatch = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|B)/i.exec(line)
  if (progressMatch) {
    const totalVal = parseFloat(progressMatch[2])
    const unit = progressMatch[3].toLowerCase()
    const multiplier = unit === 'kib' ? 1024
      : unit === 'mib' ? 1024 ** 2
      : unit === 'gib' ? 1024 ** 3
      : unit === 'tib' ? 1024 ** 4 : 1
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
    const multiplier = sUnit === 'kib' ? 1024
      : sUnit === 'mib' ? 1024 ** 2
      : sUnit === 'gib' ? 1024 ** 3 : 1
    task.speedBytesPerSec = Math.round(speedVal * multiplier)
    changed = true
  }

  return changed
}

// ── FFmpeg Progress (Duration, time=, size=, bitrate=) ───────────────────────

/** Parse an ffmpeg progress line. Returns true if any task field changed. */
export function parseFfmpegProgress(
  line: string,
  task: DownloadTask,
  state: FfmpegState,
): boolean {
  let changed = false

  // Always capture Duration header
  if (state.totalDuration === null) {
    const durMatch = /Duration:\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(line)
    if (durMatch) {
      state.totalDuration = parseTimeToSeconds(durMatch[1])
    }
  }

  // Parse size= → downloadedBytes
  // Matches both classic log (`size=  1234kB`) and -progress pipe:2 (`total_size=1234`)
  const sizeMatch = /size=\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|kB|B)\b/i.exec(line)
  if (sizeMatch) {
    const sizeVal = parseFloat(sizeMatch[1])
    const sUnit = sizeMatch[2]
    const multiplier = /^KiB$/i.test(sUnit) ? 1024
      : /^MiB$/i.test(sUnit) ? 1024 ** 2
      : /^GiB$/i.test(sUnit) ? 1024 ** 3
      : /^kB$/i.test(sUnit) ? 1000 : 1
    const bytes = Math.round(sizeVal * multiplier)
    if (bytes > 0) {
      task.downloadedBytes = bytes
      changed = true
    }
  } else {
    // Structured: total_size=<plain bytes>
    const plainSizeMatch = /^total_size=(\d+)$/.exec(line.trim())
    if (plainSizeMatch) {
      const bytes = parseInt(plainSizeMatch[1], 10)
      if (bytes > 0) {
        task.downloadedBytes = bytes
        changed = true
      }
    }
  }

  // Parse bitrate= → speedBytesPerSec
  const bitrateMatch = /bitrate=\s*(\d+(?:\.\d+)?)\s*(kbits|Mbits)\/s/i.exec(line)
  if (bitrateMatch) {
    const val = parseFloat(bitrateMatch[1])
    const bUnit = bitrateMatch[2].toLowerCase()
    const bitsPerSec = bUnit === 'mbits' ? val * 1_000_000 : val * 1000
    const bytesPerSec = Math.round(bitsPerSec / 8)
    if (bytesPerSec > 0) {
      task.speedBytesPerSec = bytesPerSec
      changed = true
    }
  }

  // Parse speed=X.Xx — present in both inline multi-field progress lines
  // (e.g. "... bitrate=3251kbits/s speed=1.72x") and -progress pipe:2 per-line
  // format.  It's a realtime multiplier, not downloadable bytes/sec, so actual
  // throughput comes from bitrate= above.  We still mark changed=true so the
  // first progress event breaks the UI out of the "Accelerating..." state even
  // if bitrate= hasn't fired yet.
  if (!bitrateMatch && /\bspeed=\s*\d+(?:\.\d+)?x\b/.test(line)) {
    changed = true
  }

  // Parse time= → percent (context-dependent)
  const timeMatch = /\b(?:out_)?time=(-?\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(line)
  const outTimeUnitsMatch = /^out_time_(?:ms|us)=(\d+)$/.exec(line.trim())
  if (timeMatch || outTimeUnitsMatch) {
    // FFmpeg's historical out_time_ms value is in AV_TIME_BASE units
    // (microseconds), despite the name.
    const currentSec = timeMatch
      ? parseTimeToSeconds(timeMatch[1])
      : parseInt(outTimeUnitsMatch![1], 10) / 1_000_000
    if (currentSec <= 0) return changed

    let totalDuration = state.totalDuration
    if (task.startTime && task.endTime) {
      const trimDur = parseTimeToSeconds(task.endTime) - parseTimeToSeconds(task.startTime)
      if (trimDur > 0) totalDuration = trimDur
    } else if (!task.startTime && task.endTime) {
      const endSec = parseTimeToSeconds(task.endTime)
      if (endSec > 0) totalDuration = endSec
    } else if (task.startTime && !task.endTime && state.totalDuration) {
      const startSec = parseTimeToSeconds(task.startTime)
      if (state.totalDuration > startSec) totalDuration = state.totalDuration - startSec
    }

    if (totalDuration && totalDuration > 0) {
      const pct = Math.min(99, Math.round((currentSec / totalDuration) * 100))
      if (task.status === 'downloading') {
        // TRIM MODE: ffmpeg is the downloader
        task.downloadPercent = pct
        changed = true
      } else if (task.status === 'converting' || task.status === 'merging') {
        // POST-PROCESSING: ffmpeg is muxing/recoding
        task.convertingPercent = pct
        changed = true
      }
    }
  }

  return changed
}

// ── State Transitions ────────────────────────────────────────────────────────

export interface TransitionResult {
  transitioned: boolean
  detectedPath: string | null
}

/** Detect state transitions from yt-dlp info lines (merger, converter, etc.) */
export function parseStateTransition(
  line: string,
  task: DownloadTask,
  state: FfmpegState,
  ctx: { sendUpdate: (task: DownloadTask) => void; saveState: () => void },
): TransitionResult {
  let detectedPath: string | null = null

  // Capture final output path
  const destMatch = /Destination:\s*(.+)$/.exec(line)
    ?? /Merging formats into "(.+)"/.exec(line)
  if (destMatch) {
    const possiblePath = destMatch[1].trim().replace(/^["']|["']$/g, '')
    if (possiblePath) detectedPath = possiblePath
  }

  // Postprocess template: CORTEX_PP:<filepath>
  const ppMatch = /CORTEX_PP:(.+)$/.exec(line)
  if (ppMatch) {
    const ppPath = ppMatch[1].trim()
    if (ppPath && ppPath !== 'NA') detectedPath = ppPath
  }

  // Merger state detection (lightweight muxing)
  if (line.includes('[Merger]') || line.includes('Merging formats')) {
    task.downloadPercent = 100
    task.status = 'merging'
    task.convertingPercent = 0
    state.totalDuration = null
    const durMatch = /Duration:\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(state.stderr)
    if (durMatch) state.totalDuration = parseTimeToSeconds(durMatch[1])
    ctx.saveState()
    ctx.sendUpdate(task)
    return { transitioned: true, detectedPath }
  }

  // Converting/recoding state detection
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
    task.convertingPercent = 0
    state.totalDuration = null
    const durMatch = /Duration:\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(state.stderr)
    if (durMatch) state.totalDuration = parseTimeToSeconds(durMatch[1])
    ctx.saveState()
    ctx.sendUpdate(task)
    return { transitioned: true, detectedPath }
  }

  return { transitioned: false, detectedPath }
}

// ── Line Buffering ───────────────────────────────────────────────────────────

/** Split a buffer into complete lines. Returns [completedLines, remainingBuffer]. */
export function flushLines(buf: string, chunk: string): [string[], string] {
  buf += chunk
  // FFmpeg's classic progress output rewrites a single terminal line with
  // carriage returns (`\r`) instead of newline-delimited records. yt-dlp
  // switches to that FFmpeg dialect during --download-sections trim jobs, so
  // treating only `\n` as a line boundary leaves progress buffered until exit.
  const parts = buf.split(/\r\n|[\r\n]/)
  const remainder = parts.pop() || ''
  return [parts, remainder]
}
