import type { DownloadTask, EngineContext, TaskRuntime } from '../types'
import log from 'electron-log'
import { runFfmpegDownload } from '../ffmpegEngine'
import type { IEngine } from './IEngine'

/**
 * FfmpegEngine: IEngine wrapper around runFfmpegDownload().
 *
 * This adapter exists so the orchestrator can treat all engines uniformly
 * via the `IEngine` contract.
 */
export class FfmpegEngine implements IEngine {
  private runtime: TaskRuntime | null = null

  async download(task: DownloadTask, context?: EngineContext): Promise<void> {
    if (!context) throw new Error('[FfmpegEngine] Missing EngineContext')

    this.runtime = context.runtime
    log.info(`[FfmpegEngine] Starting ffmpeg download for task ${task.id}`)

    return runFfmpegDownload(task, context.runtime, context)
  }

  pause(): void {
    // Orchestrator will also abort and kill the process tree.
    this.runtime?.abortController?.abort()
  }

  stop(): void {
    // Orchestrator will also abort and kill the process tree.
    this.runtime?.abortController?.abort()
  }
}

