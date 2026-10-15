import { type DownloadTask, type EngineContext, type EngineResult } from '../types'

export interface IEngine {
  download(task: DownloadTask, context?: EngineContext): Promise<EngineResult>;
  pause(): void;
  stop(): void;
}
