/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FFmpeg Engine — HLS (M3U8) and direct media conversion downloads.
 *
 *  Used for:
 *  - HLS streams (M3U8 playlists)
 *  - Audio format extraction from media URLs
 *  - Container format conversion
 *
 *  Supports all video formats (MP4, MKV, AVI, MOV, WEBM, GIF)
 *  and all audio formats (MP3, WAV, M4A, OGG, FLAC).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import type { DownloadTask, TaskRuntime, EngineContext, AudioFormat, TargetFormat } from './types'
import { AUDIO_FORMATS } from './types'
import { getBinaryPath } from './paths'
import { nowMs, getFileSizeIfExists, sendNotification, parseTimeToSeconds } from './utils'
import { parseFfmpegProgress, flushLines } from './progressParser'
import type { FfmpegState } from './progressParser'

// ── FFmpeg Availability Check ────────────────────────────────────────────────

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    const p = spawn(getBinaryPath('ffmpeg'), ['-version'], { windowsHide: true, detached: false })
    const exitCode: number = await new Promise((resolve) => {
      p.on('close', (code) => resolve(code ?? 1))
      p.on('error', () => resolve(1))
    })
    return exitCode === 0
  } catch {
    return false
  }
}

// ── Output Validation (for resume support) ──────────────────────────────────

/**
 * Quick probe: open the file with FFmpeg in error-only mode and process
 * the first second.  If the container headers are corrupt or missing
 * (e.g. truncated MP4 without moov atom), FFmpeg will return non-zero.
 */
async function isOutputValid(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(getBinaryPath('ffmpeg'), [
        '-v', 'error', '-i', filePath, '-t', '1', '-f', 'null', '-',
      ], { windowsHide: true, detached: false })

      let stderr = ''
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

      const timer = setTimeout(() => { proc.kill(); resolve(false) }, 5000)

      proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0 && !stderr.trim()) })
      proc.on('error', () => { clearTimeout(timer); resolve(false) })
    } catch {
      resolve(false)
    }
  })
}

// ── FFmpeg Spawn ─────────────────────────────────────────────────────────────

function spawnFfmpeg(
  url: string,
  outputPath: string,
  format: TargetFormat,
  startTime?: string,
  endTime?: string,
): ChildProcessWithoutNullStreams {
  // Pre-input flags: overwrite, progress, fast input seek
    const pre = ['-y', '-threads', '2', '-progress', 'pipe:2']
  if (startTime) pre.push('-ss', startTime)   // input seek (fast)
  pre.push('-i', url)

  // Post-input duration limit
  if (startTime && endTime) {
    const dur = parseTimeToSeconds(endTime) - parseTimeToSeconds(startTime)
    if (dur > 0) pre.push('-t', String(dur))
  } else if (endTime && !startTime) {
    pre.push('-to', endTime)  // absolute end position
  }

  let tail: string[]

  if (AUDIO_FORMATS.includes(format as AudioFormat)) {
    switch (format) {
      case 'mp3':  tail = ['-vn', '-acodec', 'libmp3lame', '-q:a', '0', outputPath]; break
      case 'm4a':  tail = ['-vn', '-acodec', 'aac', '-b:a', '256k', outputPath]; break
      case 'flac': tail = ['-vn', '-acodec', 'flac', outputPath]; break
      case 'wav':  tail = ['-vn', '-acodec', 'pcm_s16le', outputPath]; break
      case 'ogg':  tail = ['-vn', '-acodec', 'libvorbis', '-q:a', '6', outputPath]; break
      default:     tail = ['-vn', '-acodec', 'libmp3lame', '-q:a', '0', outputPath]
    }
  } else {
    switch (format) {
      case 'mkv':  tail = ['-c', 'copy', outputPath]; break
      case 'avi':  tail = ['-c:v', 'copy', '-c:a', 'mp3', outputPath]; break
      case 'mov':  tail = ['-c', 'copy', '-movflags', '+faststart', outputPath]; break
      case 'webm': tail = ['-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-b:v', '0', '-crf', '30', '-threads', '2', '-speed', '4', outputPath]; break
      case 'gif':  tail = ['-vf', 'fps=10,scale=480:-1:flags=lanczos', '-loop', '0', outputPath]; break
      default:     tail = ['-c', 'copy', '-bsf:a', 'aac_adtstoasc', outputPath]
    }
  }

  return spawn(getBinaryPath('ffmpeg'), [...pre, ...tail], { windowsHide: true, detached: false })
}

// ── Engine Entry Point ───────────────────────────────────────────────────────

export async function runFfmpegDownload(
  task: DownloadTask,
  runtime: TaskRuntime,
  ctx: EngineContext,
): Promise<void> {
  if (!(await isFfmpegAvailable())) {
    task.status = 'error'
    task.errorMessage = 'FFmpeg is not installed or not found in PATH'
    task.updatedAtMs = nowMs()
    ctx.sendUpdate(task)
    return
  }

  // ── Resume: skip if output file already exists and is valid ─────────
  const existingSize = await getFileSizeIfExists(task.filePath)
  if (existingSize > 0) {
    const valid = await isOutputValid(task.filePath)
    if (valid) {
      task.status = 'completed'
      task.totalBytes = existingSize
      task.downloadedBytes = existingSize
      runtime.retries = 0
      ctx.flushSave()
      ctx.sendUpdate(task)
      sendNotification('Download Complete', `${task.title || task.filename} was already downloaded.`)
      return
    }
    // Incomplete/corrupt — remove before re-downloading
    await fs.unlink(task.filePath).catch(() => {})
  }

  runtime.abortController?.abort()
  runtime.abortController = new AbortController()
  runtime.lastSpeedSampleAtMs = null
  runtime.lastSpeedSampleBytes = null

  task.totalBytes = null
  task.downloadedBytes = 0
  task.speedBytesPerSec = null
  task.status = 'downloading'
  task.errorMessage = null
  task.updatedAtMs = nowMs()
  ctx.sendUpdate(task)

  try {
    const proc = spawnFfmpeg(task.url, task.filePath, task.targetFormat, task.startTime, task.endTime)
    runtime.child = proc

    // ── Wire progress parsing on stderr ─────────────────────────────────
    // Pre-seed trim duration so progress starts on the very first time= tick
    // instead of waiting for the Duration header (which may never arrive for HLS).
    let preseededDuration: number | null = null
    if (task.startTime && task.endTime) {
      const dur = parseTimeToSeconds(task.endTime) - parseTimeToSeconds(task.startTime)
      if (dur > 0) preseededDuration = dur
    }
    const ffState: FfmpegState = { totalDuration: preseededDuration, stderr: '' }
    let stderrBuf = ''
    let lastProgressAtMs = 0
    const MAX_STDERR_BYTES = 64 * 1024

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      ffState.stderr += chunk
      if (ffState.stderr.length > MAX_STDERR_BYTES) {
        ffState.stderr = ffState.stderr.slice(-MAX_STDERR_BYTES)
      }

      let lines: string[]
      ;[lines, stderrBuf] = flushLines(stderrBuf, chunk)

      let changed = false
      for (const line of lines) {
        if (!line.trim()) continue
        if (parseFfmpegProgress(line, task, ffState)) changed = true
      }

      if (changed) {
        const now = nowMs()
        if (now - lastProgressAtMs > 200) {
          lastProgressAtMs = now
          task.updatedAtMs = now
          ctx.sendUpdate(task)
          ctx.saveState()
        }
      }
    })

    const exitCode: number = await new Promise((resolve) => {
      proc.on('close', (code) => resolve(code ?? 1))
      proc.on('error', () => resolve(1))
    })

    if (runtime.abortController?.signal.aborted) return

    if (exitCode === 0) {
      task.status = 'completed'
      task.updatedAtMs = nowMs()
      runtime.retries = 0

      try {
        const finalSize = await getFileSizeIfExists(task.filePath)
        if (finalSize > 0) {
          task.totalBytes = finalSize
          task.downloadedBytes = finalSize
        }
      } catch { /* ignore size check errors */ }

      ctx.flushSave()
      ctx.sendUpdate(task)
      sendNotification('Download Complete', `${task.title || task.filename} downloaded successfully.`)
      return
    }

    // Retry with backoff
    if (runtime.retries < 3) {
      runtime.retries++
      task.status = 'queued'
      task.errorMessage = `FFmpeg failed, retrying (${runtime.retries}/3)...`
      task.updatedAtMs = nowMs()
      ctx.sendUpdate(task)
      await delay(3000 * runtime.retries)
      return
    }

    task.status = 'error'
    task.errorMessage = `FFmpeg failed (exit code ${exitCode})`
    task.updatedAtMs = nowMs()
    ctx.flushSave()
    ctx.sendUpdate(task)
    sendNotification('Download Failed', `FFmpeg failed processing ${task.title || task.filename}`)
  } finally {
    runtime.child = null
  }
}
