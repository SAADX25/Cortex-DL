import type { DownloadTask, EngineContext } from '../types';

/**
 * Shared contract for all download engines.
 * Each engine handles a specific protocol or tool (Direct HTTP, yt-dlp, etc.)
 */
export interface IEngine {
  /**
   * Starts or resumes the download task.
   * Implementation must handle its own progress reporting via electron-log
   * and resolve when the primary file is on disk.
   * 
   * Optional context parameter provides access to:
   * - sendUpdate(task): Send progress updates to UI and database
   * - sendStats(id, bytes): Send statistics to UI
   * - saveState(): Save state to database
   */
  download(task: DownloadTask, context?: EngineContext): Promise<void>;

  /**
   * Gracefully pauses the download.
   */
  pause(): void;

  /**
   * Forces an immediate stop/abort.
   */
  stop(): void;
}
