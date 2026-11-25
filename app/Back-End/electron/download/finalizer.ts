// Post-download finalization: media probing, fast-cut audio alignment, remux/transcode, validation, and atomic promotion
import { type BrowserWindow } from 'electron'
import log from 'electron-log'
import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import { updateTaskProgress } from '../../../Shared/progressModel'
import { youtubeDiagnostic } from '../engines/ytdlpService'
import {
  decideMediaConversion,
  isAudioFormat,
  matchesMediaFormat,
  mediaOutputArgs,
  probeMediaFile,
  probeStreamStartTimes,
  runMediaProcess,
  trimBounds,
  validateMediaOutput,
} from '../services/mediaService'
import { STATS_CHANNEL, type AttemptRuntime, type DownloadTask, type EngineContext } from '../types'
import { clearPendingTrailing, nowMs, sendNotification, sendUpdate } from '../utils'

export interface FinalizeDownloadDeps {
  task: DownloadTask
  draft: DownloadTask
  attempt: AttemptRuntime
  ctx: EngineContext
  source: string
  sectionTrimmed: boolean
  win: BrowserWindow | null
  countedStats: Set<string>
  assertCurrent: () => void
  reserveOutputPath: (directory: string, filename: string, exceptId?: string) => string
  saveStateImmediate: (taskId: string) => void
}

export async function finalizeDownload({
  task,
  draft,
  attempt,
  ctx,
  source,
  sectionTrimmed,
  win,
  countedStats,
  assertCurrent,
  reserveOutputPath,
  saveStateImmediate,
}: FinalizeDownloadDeps): Promise<void> {
  const check = assertCurrent
  if (path.dirname(path.resolve(source)) !== path.resolve(attempt.directory)) {
    throw new Error('Candidate is not attempt-owned')
  }

  const phase = (value: 'validating' | 'trimming' | 'converting' | 'merging' | 'finalizing') => {
    check()
    draft.phase = value
    draft.status =
      value === 'merging'
        ? 'merging'
        : value === 'trimming' || value === 'converting'
          ? 'converting'
          : draft.status
    draft.convertingPercent = undefined
    ctx.sendUpdate(draft)
  }

  phase('validating')
  const probe = await probeMediaFile(
    source,
    child => {
      attempt.child = child
    },
    attempt.abortController!.signal,
  )
  check()

  const bounds = trimBounds(task)
  const trimming = Boolean(task.startTime || task.endTime)
  const duration = Number(probe.format?.duration)
  let expectedDuration: number | undefined
  let localTrimStart = bounds.start
  let needsLocalTrim = false
  let alignAudioSkip: number | null = null
  let needsTimestampReset = false
  let alignedProgressDuration: number | undefined

  if (trimming) {
    if (sectionTrimmed) {
      if (bounds.end !== undefined) {
        expectedDuration = Math.max(0.1, bounds.end - bounds.start)
        if (
          task.trimMode === 'exact' &&
          Number.isFinite(duration) &&
          duration > expectedDuration + 0.75
        ) {
          localTrimStart = 0
          needsLocalTrim = true
        }
      }
      if (!isAudioFormat(task.targetFormat) && task.targetFormat !== 'gif') {
        const hasVideo = Boolean(
          probe.streams?.some(s => s.codec_type === 'video' && !s.disposition?.attached_pic),
        )
        const hasAudio = Boolean(probe.streams?.some(s => s.codec_type === 'audio'))
        if (hasVideo && hasAudio) {
          const starts = await probeStreamStartTimes(
            source,
            child => {
              attempt.child = child
            },
            attempt.abortController!.signal,
          )
          check()
          if (starts.videoStart !== null && starts.audioStart !== null) {
            if (!needsLocalTrim && starts.videoStart > starts.audioStart + 0.1) {
              // Fast-cut audio pre-roll starts ahead of the video keyframe; trim leading audio losslessly to match video.
              alignAudioSkip = Math.max(0, starts.videoStart - starts.formatStart)
              if (Number.isFinite(duration) && duration > alignAudioSkip) {
                alignedProgressDuration = Math.max(0.1, duration - alignAudioSkip)
              }
            } else if (starts.audioStart > starts.videoStart + 0.15) {
              // Audio starts after video (silent lead-in); trim from audio start so the output has sound from 00:00.
              localTrimStart = Math.max(0, starts.audioStart - starts.formatStart)
              needsLocalTrim = true
            } else if (!needsLocalTrim && starts.formatStart > 0.25) {
              // Single muxed stream downloaded with -copyts; remux cleanly to reset container timestamps to 00:00.
              needsTimestampReset = true
            }
          }
        }
      }
    } else {
      if (!Number.isFinite(duration) || duration <= bounds.start) {
        throw new Error('Trim start exceeds media duration')
      }
      expectedDuration = Math.min(bounds.end ?? duration, duration) - bounds.start
      needsLocalTrim = true
    }
  }

  let candidate = source
  const sourceExt = path.extname(source).slice(1).toLowerCase()
  const needsContainerRemux =
    (task.targetFormat === 'webm' && sourceExt !== 'webm') ||
    (task.targetFormat === 'mov' && sourceExt !== 'mov') ||
    (task.targetFormat === 'mp4' && sourceExt !== 'mp4')

  if (
    needsLocalTrim ||
    alignAudioSkip !== null ||
    needsTimestampReset ||
    needsContainerRemux ||
    !matchesMediaFormat(task.targetFormat, probe)
  ) {
    const conversion = decideMediaConversion(task.targetFormat, probe, needsLocalTrim)
    const phaseDecision =
      conversion === 'direct' &&
      (needsContainerRemux || alignAudioSkip !== null || needsTimestampReset)
        ? 'remux'
        : conversion
    if (task.engine === 'ytdlp') {
      youtubeDiagnostic('conversion', {
        decision: phaseDecision,
        targetFormat: task.targetFormat,
        trimming: needsLocalTrim || alignAudioSkip !== null,
      })
    }
    log.info(`[Finalize] ${task.id}: ${phaseDecision} to ${task.targetFormat}`)
    phase(
      needsLocalTrim || alignAudioSkip !== null
        ? 'trimming'
        : phaseDecision === 'remux'
          ? 'merging'
          : 'converting',
    )
    candidate = path.join(attempt.directory, `candidate.${task.targetFormat}`)
    const args = needsLocalTrim
      ? [
          ...(localTrimStart > 0 ? ['-ss', String(localTrimStart)] : []),
          '-i',
          source,
          ...(expectedDuration !== undefined ? ['-t', String(expectedDuration)] : []),
          ...mediaOutputArgs(task.targetFormat, candidate, probe, true, {
            avoidNegativeTs: true,
          }),
        ]
      : alignAudioSkip !== null
        ? [
            '-analyzeduration',
            '30000000',
            '-probesize',
            '50000000',
            '-itsoffset',
            String(-alignAudioSkip),
            '-i',
            source,
            '-analyzeduration',
            '30000000',
            '-probesize',
            '50000000',
            '-ss',
            String(alignAudioSkip),
            '-i',
            source,
            ...mediaOutputArgs(task.targetFormat, candidate, probe, false, {
              audioInputIndex: 1,
              avoidNegativeTs: true,
            }),
          ]
        : [
            ...(needsTimestampReset
              ? ['-analyzeduration', '30000000', '-probesize', '50000000']
              : []),
            '-i',
            source,
            ...mediaOutputArgs(task.targetFormat, candidate, probe, false, {
              avoidNegativeTs: needsTimestampReset,
            }),
          ]
    await runMediaProcess(
      args,
      draft,
      ctx,
      alignedProgressDuration ??
        expectedDuration ??
        (Number.isFinite(duration) ? duration : undefined),
    )
    check()
  }

  phase('validating')
  const finalProbe = await probeMediaFile(
    candidate,
    child => {
      attempt.child = child
    },
    attempt.abortController!.signal,
  )
  if (task.engine === 'ytdlp') {
    const summarize = (streams: typeof probe.streams) =>
      streams?.map(stream => ({
        type: stream.codec_type,
        codec: stream.codec_name,
        width: stream.width,
        height: stream.height,
        fps: stream.avg_frame_rate,
        language: stream.tags?.language,
      }))
    youtubeDiagnostic('output-validation', {
      source: summarize(probe.streams),
      final: summarize(finalProbe.streams),
    })
  }
  check()

  if (!matchesMediaFormat(task.targetFormat, finalProbe)) {
    throw new Error(`Invalid ${task.targetFormat} container or codec`)
  }
  const actualDuration = Number(
    finalProbe.format?.duration ?? finalProbe.streams?.find(s => s.duration)?.duration,
  )
  // Live and keyframe-fast section trims cut on looser boundaries than exact re-encodes, so widen tolerance accordingly.
  const durationTolerance =
    sectionTrimmed && (task.isLive || draft.isLive)
      ? Math.max(2, Math.min(6, (expectedDuration ?? 0) * 0.15))
      : sectionTrimmed && task.trimMode !== 'exact'
        ? Math.max(10, Math.min(15, (expectedDuration ?? 0) * 0.2))
        : sectionTrimmed
          ? Math.max(0.5, Math.min(1.5, (expectedDuration ?? 0) * 0.03))
          : Math.max(0.25, Math.min(1, (expectedDuration ?? 0) * 0.02))
  if (
    expectedDuration !== undefined &&
    (!Number.isFinite(actualDuration) ||
      Math.abs(actualDuration - expectedDuration) > durationTolerance)
  ) {
    throw new Error('Trim duration failed validation')
  }
  await validateMediaOutput(
    candidate,
    draft,
    ctx,
    Number.isFinite(actualDuration) && actualDuration > 0 ? actualDuration : undefined,
  )
  check()
  const size = (await fs.stat(candidate)).size
  check()
  phase('finalizing')

  const promoteExclusive = async (src: string, dst: string) => {
    // Prefer hard link for zero-copy exclusive promotion; fall back to exclusive copy on filesystems without hard-link support (e.g. FAT32/exFAT).
    try {
      await fs.link(src, dst)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (
        code === 'EXDEV' ||
        code === 'EPERM' ||
        code === 'ENOTSUP' ||
        code === 'EINVAL' ||
        code === 'ENOSYS'
      ) {
        await fs.copyFile(src, dst, fsConstants.COPYFILE_EXCL)
        return
      }
      throw error
    }
  }

  const target = reserveOutputPath(task.directory, task.filename, task.id)
  check()
  await promoteExclusive(candidate, target)
  const promoted = [target]
  try {
    check()
    const files = await fs.readdir(attempt.directory)
    check()
    for (const name of files) {
      if (!name.startsWith(`${task.id}.`) || !/\.(vtt|srt)$/i.test(name)) continue
      check()
      const subtitle = path.join(
        task.directory,
        path.parse(target).name + name.slice(task.id.length),
      )
      try {
        await promoteExclusive(path.join(attempt.directory, name), subtitle)
        promoted.push(subtitle)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      check()
    }
  } catch (error) {
    for (const file of promoted) {
      await fs.unlink(file).catch(e => log.error('[DM] Promotion rollback failed:', e))
    }
    throw error
  }

  check()
  task.filePath = target
  task.filename = path.basename(target)
  task.ownedFiles = [...(task.ownedFiles ?? []), ...promoted]
  task.outputBytes = size
  task.validatedAttemptId = attempt.attemptId
  task.status = 'completed'
  task.phase = 'completed'
  task.updatedAtMs = nowMs()
  task.speedBytesPerSec = null
  task.errorMessage = null
  task.resumeChunks = undefined
  task.resumeDirectory = undefined
  attempt.retries = 0
  updateTaskProgress(task)
  saveStateImmediate(task.id)
  clearPendingTrailing(task.id)
  sendUpdate(win, task)
  if (!countedStats.has(task.id)) {
    countedStats.add(task.id)
    if (win && !win.isDestroyed()) {
      win.webContents.send(STATS_CHANNEL, { id: task.id, addedBytes: size })
    }
  }
  sendNotification('Download Complete', `${task.title || task.filename} downloaded successfully.`)
}
