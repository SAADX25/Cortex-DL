import type { DownloadTask, EngineContext } from '../types';

export interface IEngine {
  download(task: DownloadTask, context?: EngineContext): Promise<void>;
  pause(): void;
  stop(): void;
}
