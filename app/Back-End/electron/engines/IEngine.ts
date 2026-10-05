import type { DownloadTask, EngineContext, EngineResult } from '../types';

export interface IEngine {
  download(task: DownloadTask, context?: EngineContext): Promise<EngineResult>;
  pause(): void;
  stop(): void;
}
