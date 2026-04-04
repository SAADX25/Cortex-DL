/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  yt-dlp Engine — YouTube, social media, and general video site downloads.
 *
 *  Handles:
 *  - YouTube, Facebook, Instagram, TikTok, Twitter, Vimeo, etc.
 *  - Cookie support via --cookies-from-browser or user-provided cookies.txt
 *  - Zero-CPU merge strategy (MKV → remux to target container)
 *  - Section trimming (start/end time)
 *  - Audio extraction with format conversion
 *  - File rename after download (task ID → sanitized title)
 *
 *  Progress is parsed from both stdout and stderr using the dual-stream
 *  line-buffered parser in progressParser.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  DownloadTask, TaskRuntime, EngineContext,
  AudioFormat, VideoFormat, TargetFormat,
} from './types'
import { AUDIO_FORMATS, VIDEO_FORMATS } from './types'
import { getBinaryPath, getCookiesPath } from './paths'
import { nowMs, sanitizeFilename, getFileSizeIfExists, sendNotification, parseTimeToSeconds } from './utils'
import {
  parseDownloadProgress, parseFfmpegProgress,
  parseStateTransition, flushLines,
} from './progressParser'
import type { FfmpegState } from './progressParser'
import log from 'electron-log'

// ═══════════════════════════════════════════════════════════════════════════
//  yt-dlp Spawn — builds the argument list and spawns the process
// ═══════════════════════════════════════════════════════════════════════════

function spawnYtdlp(
  url: string,
  outputPath: string,
  format: TargetFormat,
  taskId: string,
  formatId?: string,
  browser?: string,
  cookieFile?: string,
  username?: string,
  password?: string,
  speedLimit?: string,
  startTime?: string,
  endTime?: string,
) {
  const globalCookies = getCookiesPath()
  const hasCookies = !!cookieFile || !!globalCookies || (!!browser && browser !== 'none')
  const fragments = hasCookies ? '8' : '6'

  const args = [
    '--no-playlist',
    '--progress',
    '--newline',
    '--no-check-certificate',
    '--no-mtime',
    '--no-keep-video',
    '--geo-bypass',
    '--force-ipv4',
    '--no-warnings',
    // Machine-parseable progress template
    '--progress-template', 'download:CORTEX_DL:%(progress.downloaded_bytes)s:%(progress.total_bytes_estimate)s:%(progress.speed)s',
    '--progress-template', 'postprocess:CORTEX_PP:%(info.filepath)s',
    // Performance optimizations
    '--concurrent-fragments', fragments,
    '--aria2c-args', '--min-split-size=1M --max-connection-per-server=16 --max-concurrent-downloads=8 --split=8',
    '--downloader', 'aria2c',
    '--downloader', 'dash,m3u8:native',
    '--http-chunk-size', '10M',
    '--buffer-size', '32M',
    '--file-access-retries', '5',
    '--socket-timeout', '5',
    '--compat-options', 'no-live-chat',
    // Stealth user-agent
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  ]

  // Authentication
  if (username) args.push('--username', username)
  if (password) args.push('--password', password)
  if (speedLimit && speedLimit !== 'auto') args.push('--limit-rate', speedLimit)

  // Section trimming (start/end time)
  if (startTime || endTime) {
    const start = startTime || '00:00:00'
    const end = endTime || 'inf'
    args.push('--download-sections', `*${start}-${end}`)
  }

  // JS runtime detection (Deno preferred over Node for speed)
  const denoPath = getBinaryPath('deno')
  if (existsSync(denoPath)) {
    args.push('--js-runtimes', `deno:${denoPath}`)
  } else {
    const nodePath = getBinaryPath('node')
    args.push('--js-runtimes', existsSync(nodePath) ? `node:${nodePath}` : 'node')
  }

  // FFmpeg location
  const ffmpegExePath = getBinaryPath('ffmpeg')
  if (existsSync(ffmpegExePath)) {
    args.push('--ffmpeg-location', path.dirname(ffmpegExePath))
  }

  // Cookie priority: temp cookieFile > global cookies.txt > browser
  if (cookieFile) {
    args.push('--cookies', cookieFile)
  } else if (globalCookies) {
    args.push('--cookies', globalCookies)
  } else if (browser && browser !== 'none') {
    args.push('--cookies-from-browser', browser)
  }

  // ── Format Selection & Container Strategy ──────────────────────────────
  if (AUDIO_FORMATS.includes(format as AudioFormat)) {
    let audioFormatArg = format as string
    if (audioFormatArg === 'ogg') audioFormatArg = 'vorbis'
    if (audioFormatArg === 'wma') audioFormatArg = 'wav' // processed manually in renameDownloadedFile

    args.push('-x', '--audio-format', audioFormatArg, '-f', 'bestaudio/best')
    // Use good logic for audio: set quality 0 to get best VBR audio
    args.push('--audio-quality', '0')
  } else if (VIDEO_FORMATS.includes(format as VideoFormat)) {
    buildVideoFormatArgs(args, format as VideoFormat, formatId)
  } else {
    // Fallback for unknown formats — MKV is always safe
    args.push('-f', 'bestvideo+bestaudio/best', '-S', 'res,fps')
    args.push('--merge-output-format', 'mkv', '--postprocessor-args', 'ffmpeg:-c:v copy -c:a copy')
  }

  // Output: use task ID as filename (ASCII-safe), rename after download
  const downloadDir = path.dirname(outputPath)
  args.push('--paths', `temp:${downloadDir}`)
  args.push('-o', path.join(downloadDir, `${taskId}.%(ext)s`), url)

  log.info(`[ytdlpEngine] Spawning yt-dlp with arguments: \n  ${args.join(' ')}`)

  const ytProcess = spawn(getBinaryPath('yt-dlp'), args, {
    windowsHide: true,
    detached: false,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })
  
  ytProcess.on('spawn', () => {
    log.info(`[ytdlpEngine] Child process spawned successfully (PID: ${ytProcess.pid}) for task ${taskId}`)
  })
  
  return ytProcess
}

/**
 * Zero-CPU merge strategy: Always merge into MKV first (accepts ALL codecs),
 * then remux to the target container only if codecs are compatible.
 *
 * Container compatibility:
 *   MP4/MOV → H.264+AAC only (no VP9, no Opus, no AV1)
 *   MKV     → EVERYTHING
 *   WEBM    → VP9+Opus only
 *   AVI     → MPEG-4/H.264+MP3 (limited, recode often needed)
 *   GIF     → Always requires recode
 */
function buildVideoFormatArgs(args: string[], format: VideoFormat, formatId?: string): void {
  const is4K = formatId === '2160p'
  const resFragment = formatId && /^\d{3,4}p$/.test(formatId)
    ? `res:${formatId.replace('p', '')},fps`
    : 'res,fps'

  // Format selection
  if (formatId && !/^\d{3,4}p$/.test(formatId)) {
    args.push('-f', `${formatId}+bestaudio/best`)
  } else if ((format === 'mp4' || format === 'mov') && !is4K) {
    args.push('-f', 'bestvideo+bestaudio/best', '-S', `vcodec:h264,acodec:m4a,${resFragment}`)
  } else if (format === 'webm') {
    args.push('-f', 'bestvideo+bestaudio/best', '-S', `vcodec:vp9,acodec:opus,${resFragment}`)
  } else {
    args.push('-f', 'bestvideo+bestaudio/best', '-S', resFragment)
  }

  // Container / post-processing strategy
  switch (format as string) {
    case 'mkv':
    case 'ogg':
    case 'webm':
    case 'flv':
      args.push('--merge-output-format', format)
      args.push('--postprocessor-args', 'ffmpeg:-c:v copy -c:a copy')
      break
    case 'mp4':
    case 'm4v':
    case 'mov':
      args.push('--merge-output-format', 'mkv')
      args.push('--remux-video', format === 'm4v' ? 'mp4' : format)
      args.push('--postprocessor-args', 'ffmpeg:-c:v copy -c:a copy')
      break
    case 'ogv':
      args.push('--merge-output-format', 'mkv')
      args.push('--recode-video', 'ogg') // renamed to ogv in post
      args.push('--postprocessor-args', 'ffmpeg:-c:v copy -c:a copy')
      break
    case 'avi':
      args.push('--merge-output-format', 'mkv')
      args.push('--recode-video', 'avi')
      args.push('--postprocessor-args', 'ffmpeg:-c:v mpeg4 -q:v 5 -c:a mp3 -threads 0')
      break
    case 'gif':
      // Handled manually in renameDownloadedFile
      args.push('--merge-output-format', 'mp4')
      break
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Engine Entry Point
// ═══════════════════════════════════════════════════════════════════════════

export async function runYtdlpDownload(
  task: DownloadTask,
  runtime: TaskRuntime,
  ctx: EngineContext,
): Promise<void> {
  // ── Dependency Check ───────────────────────────────────────────────────
  const ytdlpPath = getBinaryPath('yt-dlp')
  const ffmpegPath = getBinaryPath('ffmpeg')

  log.info(`[ytdlpEngine] Starting download for task ${task.id} (${task.url.slice(0, 60)}...)`)

  if (!existsSync(ytdlpPath)) {
    task.status = 'error'
    task.errorMessage = 'yt-dlp binary is missing from the bin directory.'
    ctx.sendUpdate(task)
    log.error(`[ytdlpEngine] yt-dlp binary missing at ${ytdlpPath}`)
    return
  }

  if (!existsSync(ffmpegPath)) {
    task.status = 'error'
    task.errorMessage = 'ffmpeg binary is missing. High quality downloads (4K/1080p) require it.'
    ctx.sendUpdate(task)
    log.warn(`[ytdlpEngine] ffmpeg binary missing at ${ffmpegPath}`)
    return
  }

  // ── Initialize Runtime ─────────────────────────────────────────────────
  runtime.abortController?.abort()
  runtime.abortController = new AbortController()
  runtime.lastSpeedSampleAtMs = null
  runtime.lastSpeedSampleBytes = null

  task.status = 'downloading'
  task.errorMessage = null
  task.updatedAtMs = nowMs()
  ctx.sendUpdate(task)

  try {
    // ── Pre-fetch metadata (title, thumbnail) so UI shows real info early
    log.info(`[ytdlpEngine] Pre-fetching metadata for task ${task.id}...`)
    try {
      const META_TIMEOUT_MS = 15_000
      const metaArgs = ['--dump-single-json', '--no-warnings', '--no-playlist', task.url]
      const metaProc = spawn(getBinaryPath('yt-dlp'), metaArgs, { windowsHide: true, detached: false, env: { ...process.env, PYTHONUNBUFFERED: '1' } })
      let metaOut = ''
      const collectMeta = async () => {
        for await (const chunk of metaProc.stdout) {
          metaOut += chunk.toString()
        }
      }
      // Race metadata collection against a hard timeout to prevent indefinite hang
      // on bot-detection challenges or slow/stalled network connections.
      await Promise.race([
        collectMeta(),
        new Promise<void>((_, rej) =>
          setTimeout(() => { try { metaProc.kill() } catch { /* ignore */ }; rej(new Error('meta timeout')) }, META_TIMEOUT_MS)
        ),
      ])
      if (metaOut) {
        try {
          const info = JSON.parse(metaOut)
          if (info?.title) {
            task.title = String(info.title)
            // set filename base to title (extension will be resolved after download)
            const ext = path.extname(task.filename)
            task.filename = `${sanitizeFilename(task.title)}${ext || ''}`
          }
          
          let extractedThumbnail = info?.thumbnail;
          if (!extractedThumbnail && info?.thumbnails && info.thumbnails.length > 0) {
              extractedThumbnail = info.thumbnails[info.thumbnails.length - 1].url;
          }
          if (extractedThumbnail) {
              task.thumbnail = String(extractedThumbnail);
              log.info('Extracted Thumbnail URL:', task.thumbnail);

              // Force full SQLite save so thumbnail column is definitely populated
              try {
                  const dbModule = require('./db');
                  if (dbModule && dbModule.taskDb) {
                      dbModule.taskDb.upsertTask.run({
                          id: task.id,
                          title: task.title || task.filename,
                          url: task.url,
                          status: task.status,
                          progress: Math.min(100, Math.round(((task.downloadedBytes || 0) / (task.totalBytes || 1)) * 100)) || 0,
                          size: task.totalBytes || 0,
                          thumbnail: task.thumbnail || '',
                          engine: task.engine,
                          full_payload: JSON.stringify(task)
                      });
                  }
              } catch (saveErr: any) {
                  log.warn(`[ytdlpEngine] Failed to force-save thumbnail to DB: ${saveErr.message}`);
              }
          }

          log.info(`[ytdlpEngine] Metadata extracted for ${task.id}: Title="${task.title}", Thumbnail found: ${!!task.thumbnail}`)
          task.updatedAtMs = nowMs()
          ctx.sendUpdate(task)
        } catch { 
           log.warn(`[ytdlpEngine] Failed to parse metadata JSON for task ${task.id}`)
        }
      }
    } catch (metaErr: any) {
      // Non-fatal: continue without metadata
      log.warn(`[ytdlpEngine] Metadata fetch failed or timed out for task ${task.id}:`, metaErr.message)
    }

    // ── Spawn yt-dlp ──────────────────────────────────────────────────
    log.info(`[ytdlpEngine] Spawning yt-dlp download process for task ${task.id}...`)
    const proc = spawnYtdlp(
      task.url, task.filePath, task.targetFormat, task.id,
      task.ytdlpFormatId, task.cookieBrowser,
      task.cookieFile,
      task.username, task.password, task.speedLimit,
      task.startTime, task.endTime,
    )
    runtime.child = proc

    // ── Progress Parsing State ────────────────────────────────────
    // Pre-seed trim duration so the very first time= tick can compute percent
    // without waiting for a Duration: header — which never appears when yt-dlp
    // passes only the trimmed section fragments to FFmpeg.
    let preseedDuration: number | null = null
    if (task.startTime && task.endTime) {
      const td = parseTimeToSeconds(task.endTime) - parseTimeToSeconds(task.startTime)
      if (td > 0) preseedDuration = td
    }
    const ffmpegState: FfmpegState = { totalDuration: preseedDuration, stderr: '' }
    let stdoutBuf = ''
    let stderrBuf = ''
    let lastUpdateAtMs = 0
    let detectedFinalPath: string | null = null

    const progressCtx = {
      sendUpdate: (t: DownloadTask) => ctx.sendUpdate(t),
      saveState: () => ctx.saveState(),
    }

    // ── STDERR Handler ────────────────────────────────────────────────
    const MAX_STDERR_BYTES = 64 * 1024
    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      ffmpegState.stderr += chunk
      if (ffmpegState.stderr.length > MAX_STDERR_BYTES) {
        ffmpegState.stderr = ffmpegState.stderr.slice(-MAX_STDERR_BYTES)
      }

      let lines: string[]
      ;[lines, stderrBuf] = flushLines(stderrBuf, chunk)

      for (const line of lines) {
        if (!line.trim()) continue
        log.error(`[ytdlp stderr] ${line}`) 
        const ffmpegChanged = parseFfmpegProgress(line, task, ffmpegState)
        let dlChanged = false
        if (task.status === 'downloading') {
          dlChanged = parseDownloadProgress(line, task)
        }

        if (ffmpegChanged || dlChanged) {
          const now = nowMs()
          if (now - lastUpdateAtMs > 200) {
            task.updatedAtMs = now
            lastUpdateAtMs = now
            ctx.sendUpdate(task)
          }
        }

        const { detectedPath } = parseStateTransition(line, task, ffmpegState, progressCtx)
        if (detectedPath) detectedFinalPath = detectedPath
      }
    })

    // ── STDOUT Handler ────────────────────────────────────────────────
    proc.stdout.on('data', (data: Buffer) => {
      let lines: string[]
      ;[lines, stdoutBuf] = flushLines(stdoutBuf, data.toString())

      let stateChanged = false
      for (const line of lines) {
        if (!line.trim()) continue
        log.info(`[ytdlp stdout] ${line}`)  
        const { transitioned, detectedPath } = parseStateTransition(line, task, ffmpegState, progressCtx)
        if (detectedPath) detectedFinalPath = detectedPath
        if (transitioned) { stateChanged = true; continue }

        if (task.status === 'downloading' && parseDownloadProgress(line, task)) stateChanged = true
        if (parseFfmpegProgress(line, task, ffmpegState)) stateChanged = true
      }

      const now = nowMs()
      if (stateChanged && now - lastUpdateAtMs > 200) {
        task.updatedAtMs = now
        lastUpdateAtMs = now
        ctx.sendUpdate(task)
        if (Math.random() < 0.02) ctx.saveState()
      }
    })

    // ── Wait for Exit ─────────────────────────────────────────────────
    const exitCode: number = await new Promise((resolve) => {
      proc.on('close', (code) => resolve(code ?? 1))
      proc.on('error', () => resolve(1))
    })

    if (runtime.abortController?.signal.aborted) return

    // ── Success ───────────────────────────────────────────────────────
    if (exitCode === 0) {
      await renameDownloadedFile(task, detectedFinalPath)

      task.status = 'completed'
      task.updatedAtMs = nowMs()
      runtime.retries = 0

      try {
        const finalSize = await getFileSizeIfExists(task.filePath)
        if (finalSize > 0) {
          task.totalBytes = finalSize
          task.downloadedBytes = finalSize
          ctx.sendStats(task.id, finalSize)
        }
      } catch { /* ignore */ }

      ctx.flushSave()
      ctx.sendUpdate(task)
      log.info(`[ytdlpEngine] Task ${task.id} completed successfully. Final size: ${task.totalBytes} bytes.`)
      sendNotification('Download Complete', `${task.title || task.filename} downloaded successfully.`)
      return
    }

    // ── Error Handling ────────────────────────────────────────────────
    const stderr = ffmpegState.stderr
    let finalMessage = buildErrorMessage(exitCode, stderr)
    log.error(`[ytdlpEngine] Task ${task.id} exited with code ${exitCode}. Error Message: ${finalMessage}`)

    // Retry with exponential backoff — YouTube is prone to bot/network disconnects
    const MAX_RETRIES = 5
    if (runtime.retries < MAX_RETRIES) {
      runtime.retries++
      const backoffMs = Math.min(3000 * 2 ** (runtime.retries - 1), 60_000)
      log.info(`[ytdlpEngine] Retrying task ${task.id} in ${backoffMs}ms... (Attempt ${runtime.retries}/${MAX_RETRIES})`)
      task.status = 'queued'
      task.errorMessage = `Download failed, retrying (${runtime.retries}/${MAX_RETRIES})...`
      task.updatedAtMs = nowMs()
      ctx.sendUpdate(task)
      await delay(backoffMs)
      return
    }

    task.status = 'error'
    task.errorMessage = finalMessage
    task.updatedAtMs = nowMs()
    ctx.flushSave()
    ctx.sendUpdate(task)
    sendNotification('Download Failed', `Failed to download ${task.title || task.filename}`)

  } catch (err) {
    task.status = 'error'
    task.errorMessage = err instanceof Error ? err.message : 'Unexpected error'
    ctx.flushSave()
    ctx.sendUpdate(task)
  } finally {
    runtime.child = null
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Post-Download File Rename
// ═══════════════════════════════════════════════════════════════════════════
//
//  yt-dlp downloads use the task ID as filename (pure ASCII) to avoid
//  Windows CLI encoding issues. After download, we rename to the
//  sanitized title with the correct extension.
// ═══════════════════════════════════════════════════════════════════════════

async function renameDownloadedFile(
  task: DownloadTask,
  detectedFinalPath: string | null,
): Promise<void> {
  // Step 1: Find the downloaded file by task.id prefix
  let downloadedFilePath: string | null = null
  let downloadedExt: string | null = null
  try {
    const files = await fs.readdir(task.directory)
    for (const file of files) {
      if (file.startsWith(`${task.id}.`)) {
        downloadedFilePath = path.join(task.directory, file)
        downloadedExt = path.extname(file)
        break
      }
    }
  } catch { /* ignore read errors */ }

  // Step 2: Rename to sanitized title
  if (downloadedFilePath && downloadedExt) {
    let finalExt = downloadedExt
    const desiredExt = path.extname(task.filename).toLowerCase()

    let needsFfmpeg = false
    let ffmpegArgs: string[] = []

    if (desiredExt === '.gif' && downloadedExt.toLowerCase() !== '.gif') {
      needsFfmpeg = true
      ffmpegArgs = ['-y', '-i', downloadedFilePath, '-vf', 'fps=15,scale=480:-1:flags=lanczos', downloadedFilePath.replace(new RegExp(`${downloadedExt}$`, 'i'), '.gif')]
      finalExt = '.gif'
    } else if (desiredExt === '.wma' && downloadedExt.toLowerCase() !== '.wma') {
      needsFfmpeg = true
      ffmpegArgs = ['-y', '-i', downloadedFilePath, '-c:a', 'wmav2', '-b:a', '192k', downloadedFilePath.replace(new RegExp(`${downloadedExt}$`, 'i'), '.wma')]
      finalExt = '.wma'
    } else if (desiredExt === '.ogv' || desiredExt === '.m4v') {
      // Just rename the file extension
      finalExt = desiredExt
    } else if (desiredExt && desiredExt !== downloadedExt) {
      // Default to target extension if different natively
      finalExt = desiredExt
    }

    if (needsFfmpeg && ffmpegArgs.length > 0) {
      log.info(`[ytdlpEngine] Executing FFMPEG for ${desiredExt} conversion...`)
      const success = await new Promise<boolean>((resolve) => {
        const p = spawn(getBinaryPath('ffmpeg'), ffmpegArgs, { windowsHide: true })
        p.on('close', (code) => resolve(code === 0))
        p.on('error', () => resolve(false))
      })
      if (success) {
        fs.unlink(downloadedFilePath).catch(() => {})
        downloadedFilePath = ffmpegArgs[ffmpegArgs.length - 1]
        downloadedExt = finalExt
      } else {
        log.warn(`[ytdlpEngine] Failed to convert ${downloadedFilePath} to ${desiredExt}`)
      }
    }

    const originalBasename = path.basename(task.filename, path.extname(task.filename))
    const safeBasename = sanitizeFilename(originalBasename).replace(/\s+/g, '_')
    const finalFilename = `${safeBasename}${finalExt}`
    let targetPath = path.join(task.directory, finalFilename)

    // Handle name collisions
    let counter = 1
    while (existsSync(targetPath) && targetPath !== downloadedFilePath) {
      targetPath = path.join(task.directory, `${safeBasename}_${counter}${finalExt}`)
      counter++
    }

    try {
      if (downloadedFilePath !== targetPath) {
        await fs.rename(downloadedFilePath, targetPath)
      }
      task.filePath = targetPath
      task.filename = path.basename(targetPath)
    } catch {
      // Fall back to task.id-based filename if rename fails
      task.filePath = downloadedFilePath
      task.filename = path.basename(downloadedFilePath)
    }
    return
  }

  // Fallback: use detected path from yt-dlp stdout
  if (detectedFinalPath) {
    const resolvedFinal = path.isAbsolute(detectedFinalPath)
      ? detectedFinalPath
      : path.join(task.directory, detectedFinalPath)
    if (existsSync(resolvedFinal)) {
      task.filePath = resolvedFinal
      task.filename = path.basename(resolvedFinal)
      return
    }
  }

  // Last resort: scan directory for common extensions
  if (!existsSync(task.filePath)) {
    const extensions = ['ogg', 'opus', 'mp3', 'm4a', 'wav', 'flac', 'webm', 'mp4', 'mkv', 'avi', 'mov']
    for (const ext of extensions) {
      const candidate = path.join(task.directory, `${task.id}.${ext}`)
      if (existsSync(candidate)) {
        task.filePath = candidate
        task.filename = path.basename(candidate)
        break
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Error Message Builder
// ═══════════════════════════════════════════════════════════════════════════

function buildErrorMessage(exitCode: number, stderr: string): string {
  if (stderr.includes('HTTP Error 403') || stderr.includes('403: Forbidden')) {
    return 'Error 403 (Access Denied): The server rejected the request. Try updating cookies or changing your IP.'
  }

  if (stderr.includes('Sign in to confirm you') || stderr.includes('not a bot')) {
    return getCookiesPath()
      ? 'YouTube requires verification despite cookies. The cookies may be expired or invalid.'
      : 'YouTube requires verification (bot detection). Place a cookies.txt file in the app directory or select your browser for cookie extraction.'
  }

  if (stderr.includes('No supported JavaScript runtime')) {
    return 'Missing JavaScript Runtime. Place deno.exe in the bin directory to bypass YouTube protection.'
  }

  // Extract clean error line from yt-dlp output
  const cleanError = stderr.split('\n').filter(l => l.startsWith('ERROR:')).pop()
  if (cleanError) {
    return `yt-dlp error: ${cleanError.replace('ERROR:', '').trim()}`
  }

  return `Download failed (exit code ${exitCode})`
}
