import type { DownloadTask, EngineContext, TaskRuntime, EngineResult } from '../types'
import log from 'electron-log'
import { mediaOutputArgs, runMediaProcess, trimBounds } from '../services/mediaService'
import type { IEngine } from './IEngine'

export class FfmpegEngine implements IEngine {
  private runtime: TaskRuntime | null = null

  async download(task: DownloadTask, context?: EngineContext): Promise<EngineResult> {
    if (!context) throw new Error('[FfmpegEngine] Missing EngineContext')
    const runtime = context.runtime
    this.runtime = runtime
    runtime.abortController ??= new AbortController()
    task.totalBytes = null
    task.downloadedBytes = 0
    task.downloadPercent = undefined
    task.convertingPercent = undefined
    task.phase = 'downloading'
    context.sendUpdate(task)
    log.info(`[FfmpegEngine] Starting download for task ${task.id}`)

    const trimming = Boolean(task.startTime || task.endTime)
    const bounds = trimming ? trimBounds(task) : null
    const clipDuration = bounds?.end !== undefined ? Math.max(0.1, bounds.end - bounds.start) : undefined
    const inputArgs = [
      ...(bounds && bounds.start > 0 ? ['-ss', String(bounds.start)] : []),
      '-i', task.url,
      ...(clipDuration !== undefined ? ['-t', String(clipDuration)] : []),
    ]

    try {
      await runMediaProcess([...inputArgs, ...mediaOutputArgs(task.targetFormat, task.filePath, undefined, trimming)], task, context, clipDuration)
      return { kind: 'success', candidate: task.filePath, ...(trimming ? { sectionTrimmed: true } : {}) }
    } catch (error) {
      if (runtime.abortController.signal.aborted) return { kind: 'paused' }
      return { kind: 'retryable-error', message: error instanceof Error ? error.message : String(error), delayMs: 3000 * (runtime.retries + 1) }
    }
  }

  pause(): void {
    this.runtime?.abortController?.abort()
  }

  stop(): void {
    this.runtime?.abortController?.abort()
  }
}
