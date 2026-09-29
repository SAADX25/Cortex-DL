import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { DownloadTask, TaskRuntime, EngineContext, TargetFormat } from './types'
import { audioOutputArgs, isAudioFormat, matchesAudioFormat } from './audioFormats'
import { probeMediaFile } from './mediaFiles'
import { getBinaryPath } from './paths'
import { nowMs, getFileSizeIfExists, sendNotification, parseTimeToSeconds } from './utils'
import { parseFfmpegProgress, flushLines, logRawProgressChunk } from './progressParser'
import type { FfmpegState } from './progressParser'

const wasStopped = (task: DownloadTask) => task.status === 'paused' || task.status === 'canceled'

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    const p = spawn(getBinaryPath('ffmpeg'), ['-version'], { windowsHide: true, detached: false, stdio: 'ignore' })
    const exitCode: number = await new Promise((resolve) => {
      p.on('close', (code) => resolve(code ?? 1))
      p.on('error', () => resolve(1))
    })
    return exitCode === 0
  } catch {
    return false
  }
}

function spawnFfmpeg(
  url: string,
  outputPath: string,
  format: TargetFormat,
  startTime?: string,
  endTime?: string,
): ChildProcessWithoutNullStreams {
  // -threads 0: auto-detect optimal thread count
  // -hide_banner: suppress verbose build info
  // -probesize / -analyzeduration: limit how much of the stream ffmpeg reads
  //   upfront when probing media info — prevents RAM spikes for large streams.
  const pre = [
    '-y',
    '-hide_banner',
    '-probesize', '10M',
    '-analyzeduration', '5000000',
    '-threads', '0',
    '-progress', 'pipe:2',
  ]
  if (startTime || endTime) {
    pre.push('-avoid_negative_ts', 'make_zero', '-async', '1')
  }
  if (startTime) pre.push('-ss', startTime)
  pre.push('-i', url)

  
  if (startTime && endTime) {
    const dur = parseTimeToSeconds(endTime) - parseTimeToSeconds(startTime)
    if (dur > 0) pre.push('-t', String(dur))
  } else if (endTime && !startTime) {
    pre.push('-to', endTime)  
  }

  let tail: string[]

  if (isAudioFormat(format)) {
    tail = audioOutputArgs(format, outputPath)
  } else {
    switch (format) {
      case 'mkv':  tail = ['-c', 'copy', outputPath]; break
      case 'avi':  tail = ['-c:v', 'copy', '-c:a', 'mp3', outputPath]; break
      case 'mov':  tail = ['-c', 'copy', '-movflags', '+faststart', outputPath]; break
      // webm requires full re-encode; ultrafast preset minimises CPU impact
      case 'webm': tail = ['-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-b:v', '0', '-crf', '30', '-threads', '0', '-speed', '5', '-deadline', 'realtime', outputPath]; break
      case 'ogv':  tail = ['-c:v', 'libtheora', '-c:a', 'libvorbis', outputPath]; break
      case 'm4v':  tail = ['-c:v', 'copy', '-c:a', 'aac', '-f', 'mp4', outputPath]; break
      case 'gif':  tail = ['-vf', 'fps=10,scale=480:-1:flags=lanczos', '-loop', '0', outputPath]; break
      // mp4: use copy for video to avoid re-encode; aac for audio
      default:     tail = ['-c:v', 'copy', '-c:a', 'aac', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', outputPath]
    }
  }

  return spawn(getBinaryPath('ffmpeg'), [...pre, '-max_muxing_queue_size', '1024', ...tail], { windowsHide: true, detached: false })
}

export async function runFfmpegDownload(
  task: DownloadTask,
  runtime: TaskRuntime,
  ctx: EngineContext,
): Promise<void> {
  const available = await isFfmpegAvailable()
  if (wasStopped(task)) return
  if (!available) {
    task.status = 'error'
    task.errorMessage = 'FFmpeg is not installed or not found in PATH'
    task.updatedAtMs = nowMs()
    ctx.sendUpdate(task)
    return
  }

  
  // FFmpeg output cannot be safely appended. An interrupted file may decode
  // its first second, so every new attempt starts with a fresh output.
  await fs.unlink(task.filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (wasStopped(task)) return

  runtime.abortController?.abort()
  runtime.abortController = new AbortController()
  runtime.lastSpeedSampleAtMs = null
  runtime.lastSpeedSampleBytes = null

  task.totalBytes = null
  task.downloadedBytes = 0
  task.downloadPercent = undefined
  task.convertingPercent = undefined
  task.speedBytesPerSec = null
  task.status = 'downloading'
  task.errorMessage = null
  task.updatedAtMs = nowMs()
  ctx.sendUpdate(task)

  try {
    const proc = spawnFfmpeg(task.url, task.filePath, task.targetFormat, task.startTime, task.endTime)
    runtime.child = proc

    
    
    
    let preseededDuration: number | null = null
    if (task.startTime && task.endTime) {
      const dur = parseTimeToSeconds(task.endTime) - parseTimeToSeconds(task.startTime)
      if (dur > 0) preseededDuration = dur
    } else if (!task.startTime && task.endTime) {
      const endSec = parseTimeToSeconds(task.endTime)
      if (endSec > 0) preseededDuration = endSec
    }
    const ffState: FfmpegState = { totalDuration: preseededDuration, stderr: '' }
    let stderrBuf = ''
    let stdoutBuf = ''
    let lastProgressAtMs = 0
    const MAX_STDERR_BYTES = 64 * 1024

    const handleProgressChunk = (source: string, chunk: string) => {
      logRawProgressChunk(task.id, source, chunk)

      let lines: string[]
      if (source.endsWith('stderr')) {
        const flushed = flushLines(stderrBuf, chunk)
        lines = flushed[0]
        stderrBuf = flushed[1]
      } else {
        const flushed = flushLines(stdoutBuf, chunk)
        lines = flushed[0]
        stdoutBuf = flushed[1]
      }

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
    }

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      ffState.stderr += chunk
      if (ffState.stderr.length > MAX_STDERR_BYTES) {
        ffState.stderr = ffState.stderr.slice(-MAX_STDERR_BYTES)
      }

      handleProgressChunk('ffmpeg:stderr', chunk)
    })

    proc.stdout.on('data', (data: Buffer) => {
      handleProgressChunk('ffmpeg:stdout', data.toString())
    })

    const exitCode: number = await new Promise((resolve) => {
      proc.on('close', (code) => resolve(code ?? 1))
      proc.on('error', () => resolve(1))
    })

    if (runtime.abortController?.signal.aborted) return

    if (exitCode === 0) {
      const finalSize = await getFileSizeIfExists(task.filePath)
      if (finalSize <= 0) throw new Error('FFmpeg exited successfully without an output file')
      if (isAudioFormat(task.targetFormat)) {
        const probe = await probeMediaFile(task.filePath, child => { runtime.child = child })
        if (runtime.abortController?.signal.aborted) return
        if (!matchesAudioFormat(task.targetFormat, probe)) {
          throw new Error(`FFmpeg produced an invalid ${task.targetFormat} audio file`)
        }
      }
      task.status = 'completed'
      task.updatedAtMs = nowMs()
      runtime.retries = 0

      task.totalBytes = finalSize
      task.downloadedBytes = finalSize

      ctx.flushSave()
      ctx.sendUpdate(task)
      sendNotification('Download Complete', `${task.title || task.filename} downloaded successfully.`)
      return
    }

    
    if (runtime.retries < 3) {
      runtime.retries++
      task.status = 'queued'
      task.errorMessage = `FFmpeg failed, retrying (${runtime.retries}/3)...`
      task.updatedAtMs = nowMs()
      ctx.sendUpdate(task)
      // ── Priority 4 (applied for consistency): blocking retry logic fix ──
      // This engine had the exact same issue as YoutubeEngine: sleeping
      // inline here occupies an active concurrency slot in
      // DownloadManager for the full backoff. Retry scheduling is now
      // owned by the DownloadManager (see EngineContext.scheduleRetry).
      ctx.scheduleRetry(3000 * runtime.retries)
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
