import type { DownloadTask } from './types'
import { parseTimeToSeconds } from './utils'
import log from 'electron-log'



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


export function parseDownloadProgress(line: string, task: DownloadTask): boolean {
  let changed = false

  
  
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


export function parseFfmpegProgress(
  line: string,
  task: DownloadTask,
  state: FfmpegState,
): boolean {
  let changed = false

  
  if (state.totalDuration === null) {
    const durMatch = /Duration:\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(line)
    if (durMatch) {
      state.totalDuration = parseTimeToSeconds(durMatch[1])
    }
  }


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
    
    const plainSizeMatch = /^total_size=(\d+)$/.exec(line.trim())
    if (plainSizeMatch) {
      const bytes = parseInt(plainSizeMatch[1], 10)
      if (bytes > 0) {
        task.downloadedBytes = bytes
        changed = true
      }
    }
  }


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


  if (!bitrateMatch && /\bspeed=\s*\d+(?:\.\d+)?x\b/.test(line)) {
    changed = true
  }

  
  const timeMatch = /\b(?:out_)?time=(-?\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(line)
  const outTimeUnitsMatch = /^out_time_(?:ms|us)=(\d+)$/.exec(line.trim())
  if (timeMatch || outTimeUnitsMatch) {
    
    
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

/** Detect state transitions from yt-dlp info lines (merger, converter, etc.) */
export function parseStateTransition(
  line: string,
  task: DownloadTask,
  state: FfmpegState,
  ctx: { sendUpdate: (task: DownloadTask) => void; saveState: () => void },
): TransitionResult {
  let detectedPath: string | null = null

  
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


export function flushLines(buf: string, chunk: string): [string[], string] {
  buf += chunk

  const parts = buf.split(/\r\n|[\r\n]/)
  const remainder = parts.pop() || ''
  return [parts, remainder]
}
