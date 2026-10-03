import type { DownloadTask, TaskRuntime, EngineContext, EngineResult } from './types'
import { mediaOutputArgs } from './mediaFormatRegistry'
import { runMediaProcess } from './mediaPipeline'

/** Network FFmpeg output is always a fresh attempt candidate; trimming follows in the manager. */
export async function runFfmpegDownload(task: DownloadTask, runtime: TaskRuntime, ctx: EngineContext): Promise<EngineResult> {
  runtime.abortController ??= new AbortController()
  task.totalBytes = null
  task.downloadedBytes = 0
  task.downloadPercent = undefined
  task.convertingPercent = undefined
  task.phase = 'downloading'
  ctx.sendUpdate(task)
  try {
    await runMediaProcess(['-i', task.url, ...mediaOutputArgs(task.targetFormat, task.filePath)], task, ctx)
    return { kind: 'success', candidate: task.filePath }
  } catch (error) {
    if (runtime.abortController.signal.aborted) return { kind: 'paused' }
    return { kind: 'retryable-error', message: error instanceof Error ? error.message : String(error), delayMs: 3000 * (runtime.retries + 1) }
  }
}
