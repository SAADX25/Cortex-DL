import type { IEngine } from './IEngine';
import type { DownloadTask, EngineContext } from '../types';
import log from 'electron-log';
import axios from 'axios';
import { createWriteStream } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { nowMs } from '../utils';

// ═══════════════════════════════════════════════════════════════════════════
//  DirectEngine: Multi-threaded 8-chunk downloader for direct HTTP URLs
//
//  Features:
//  - HEAD request to detect Accept-Ranges support
//  - 8 concurrent chunks for maximum throughput
//  - Automatic fallback to single-stream for unsupported servers
//  - 3-retry logic per chunk with exponential backoff
//  - Real-time progress updates to UI and SQLite database
//  - Proper file handle lifecycle management
// ═══════════════════════════════════════════════════════════════════════════

interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  downloadedBytes: number;
  retries: number;
  completed: boolean;
}

export class DirectEngine implements IEngine {
  private abortController: AbortController | null = null;
  private readonly MAX_RETRIES = 3;
  private readonly NUM_CHUNKS = 8;
  private readonly MIN_FILE_SIZE_FOR_CHUNKING = 5 * 1024 * 1024; // 5 MB minimum
  private chunks: ChunkInfo[] = [];
  private lastProgressUpdate = 0;
  private lastProgressUpdateBytes = 0;

  async download(task: DownloadTask, context?: EngineContext): Promise<void> {
    log.info(`[DirectEngine] Starting download: ${task.url}`);
    this.abortController = new AbortController();

    try {
      // Step 1: HEAD request to check Accept-Ranges support
      let supportsRanges = false;
      let totalBytes: number | null = null;

      try {
        const headResponse = await axios.head(task.url, {
          timeout: 10000,
          signal: this.abortController.signal,
        });
        
        const contentLength = parseInt(headResponse.headers['content-length'] || '0', 10);
        if (contentLength > 0) {
          totalBytes = contentLength;
          supportsRanges = 
            (headResponse.headers['accept-ranges']?.toLowerCase() === 'bytes') &&
            contentLength >= this.MIN_FILE_SIZE_FOR_CHUNKING;
          
          log.info(
            `[DirectEngine] Task ${task.id}: totalBytes=${totalBytes}, ` +
            `acceptRanges=${supportsRanges}`
          );
        }
      } catch (err: any) {
        log.warn(
          `[DirectEngine] Task ${task.id} HEAD request failed, falling back to single stream:`,
          err.message
        );
      }

      // Update task with total bytes
      if (totalBytes) {
        task.totalBytes = totalBytes;
        if (context?.sendUpdate) context.sendUpdate(task);
      }

      // Step 2: Download using multi-chunk or single-stream
      if (supportsRanges && totalBytes && totalBytes > 0) {
        await this.downloadWithChunking(task, totalBytes, context);
      } else {
        await this.downloadSingleStream(task, context);
      }

      log.info(`[DirectEngine] Download completed for task ${task.id}`);

    } catch (error) {
      if (axios.isCancel(error)) {
        log.warn(`[DirectEngine] Task ${task.id} download aborted`);
        throw new Error('Download aborted');
      } else {
        log.error(`[DirectEngine] Task ${task.id} failed:`, error);
        throw error;
      }
    } finally {
      this.abortController = null;
      this.chunks = [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Single-Stream Fallback (for servers that don't support ranges)
  // ─────────────────────────────────────────────────────────────────────────

  private async downloadSingleStream(
    task: DownloadTask,
    context?: EngineContext
  ): Promise<void> {
    log.info(`[DirectEngine] Task ${task.id}: Using single-stream download`);

    const response = await axios({
      method: 'get',
      url: task.url,
      responseType: 'stream',
      signal: this.abortController?.signal,
      timeout: 300000, // 5 minutes timeout
    });

    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
    if (totalBytes > 0) {
      task.totalBytes = totalBytes;
    }

    task.downloadedBytes = 0;
    this.lastProgressUpdate = nowMs();

    const writer = createWriteStream(task.filePath);

    const progressStream = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        task.downloadedBytes += chunk.length;
        
        const now = nowMs();
        // Send update every 100ms or every 1MB
        const bytesSinceLast = task.downloadedBytes - this.lastProgressUpdateBytes;
        if (now - this.lastProgressUpdate > 100 || bytesSinceLast > 1024 * 1024) {
          if (context?.sendUpdate) {
            context.sendUpdate(task);
          } else {
            const progress = task.totalBytes && task.totalBytes > 0 
              ? (task.downloadedBytes / task.totalBytes) * 100 
              : 0;
            log.info(
              `[DirectEngine] Task ${task.id} Progress: ${progress.toFixed(2)}% ` +
              `(${this.formatBytes(task.downloadedBytes)}/${this.formatBytes(task.totalBytes || 0)})`
            );
          }
          this.lastProgressUpdate = now;
          this.lastProgressUpdateBytes = task.downloadedBytes;
        }
        callback(null, chunk);
      }
    });

    await pipeline(response.data, progressStream, writer);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Multi-Chunk Downloader (8 concurrent chunks with retry logic)
  // ─────────────────────────────────────────────────────────────────────────

  private async downloadWithChunking(
    task: DownloadTask,
    totalBytes: number,
    context?: EngineContext
  ): Promise<void> {
    log.info(`[DirectEngine] Task ${task.id}: Using 8-chunk parallel download`);

    // Ensure the file exists with correct size without allocating memory
    const fh = await fsPromises.open(task.filePath, 'w');
    await fh.truncate(totalBytes);
    await fh.close();
    
    // Create chunks
    this.chunks = this.createChunks(totalBytes);
    log.info(`[DirectEngine] Task ${task.id}: Created ${this.chunks.length} chunks`);

    task.downloadedBytes = 0;
    this.lastProgressUpdate = nowMs();
    this.lastProgressUpdateBytes = 0;

    try {
      // Download all chunks concurrently with retry logic
      const downloadPromises = this.chunks.map((chunk) =>
        this.downloadChunkWithRetry(task, chunk, context)
      );

      await Promise.all(downloadPromises);

      // Verify all chunks completed
      const allChunksComplete = this.chunks.every(c => c.completed);
      
      if (!allChunksComplete) {
        throw new Error('Not all chunks downloaded completely');
      }

      log.info(`[DirectEngine] Task ${task.id}: All ${this.chunks.length} chunks completed successfully`);

    } catch (error) {
      // Clean up partial file on failure ONLY if not aborted
      if (!this.abortController?.signal.aborted && !axios.isCancel(error)) {
        try {
          await fsPromises.unlink(task.filePath);
        } catch { /* ignore */ }
      }
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Chunk Download with Retry Logic (3 retries per chunk)
  // ─────────────────────────────────────────────────────────────────────────

  private async downloadChunkWithRetry(
    task: DownloadTask,
    chunk: ChunkInfo,
    context?: EngineContext
  ): Promise<void> {
    while (chunk.retries < this.MAX_RETRIES) {
      try {
        await this.downloadChunk(task, chunk, context);
        chunk.completed = true;
        log.info(
          `[DirectEngine] Task ${task.id}: Chunk ${chunk.index + 1}/${this.chunks.length} ` +
          `completed (${this.formatBytes(chunk.start)}-${this.formatBytes(chunk.end)})`
        );
        return;
      } catch (error: any) {
        chunk.retries++;
        log.warn(
          `[DirectEngine] Task ${task.id}: Chunk ${chunk.index + 1} failed ` +
          `(attempt ${chunk.retries}/${this.MAX_RETRIES}): ${error.message}`
        );

        if (chunk.retries >= this.MAX_RETRIES) {
          throw new Error(
            `Chunk ${chunk.index + 1} failed after ${this.MAX_RETRIES} attempts: ${error.message}`
          );
        }

        // Exponential backoff: 200ms, 400ms, 800ms
        await new Promise(r => setTimeout(r, Math.pow(2, chunk.retries) * 100));
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Core Chunk Download Logic
  // ─────────────────────────────────────────────────────────────────────────

  private async downloadChunk(
    task: DownloadTask,
    chunk: ChunkInfo,
    context?: EngineContext
  ): Promise<void> {
    if (this.abortController?.signal.aborted) {
      throw new Error('Download aborted');
    }

    const response = await axios({
      method: 'get',
      url: task.url,
      headers: {
        'Range': `bytes=${chunk.start}-${chunk.end}`,
      },
      responseType: 'stream',
      signal: this.abortController?.signal,
      timeout: 60000, // 1 minute timeout per chunk
    });

    let chunkDownloadedBytes = 0;

    const progressStream = new Transform({
      transform: (buffer: Buffer, _encoding, callback) => {
        chunkDownloadedBytes += buffer.length;
        chunk.downloadedBytes = chunkDownloadedBytes;

        // Update overall progress
        task.downloadedBytes = this.calculateTotalProgress();
        
        const now = nowMs();
        // Send update every 150ms
        if (now - this.lastProgressUpdate > 150) {
          if (context?.sendUpdate) {
            context.sendUpdate(task);
          } else {
            const progress = (task.downloadedBytes / (task.totalBytes || 1)) * 100;
            log.info(
              `[DirectEngine] Task ${task.id} Progress: ${progress.toFixed(2)}% ` +
              `(${this.formatBytes(task.downloadedBytes)}/${this.formatBytes(task.totalBytes || 0)})`
            );
          }
          this.lastProgressUpdate = now;
        }
        callback(null, buffer);
      }
    });

    // Write chunk data to file at the correct position
    await pipeline(
      response.data,
      progressStream,
      createWriteStream(task.filePath, { start: chunk.start, flags: 'r+' })
    );

    // Verify chunk size
    if (chunkDownloadedBytes !== (chunk.end - chunk.start + 1)) {
      throw new Error(
        `Chunk ${chunk.index} size mismatch: expected ${chunk.end - chunk.start + 1}, ` +
        `got ${chunkDownloadedBytes}`
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Utility Methods
  // ─────────────────────────────────────────────────────────────────────────

  private createChunks(totalBytes: number): ChunkInfo[] {
    const chunks: ChunkInfo[] = [];
    const chunkSize = Math.ceil(totalBytes / this.NUM_CHUNKS);

    for (let i = 0; i < this.NUM_CHUNKS; i++) {
      const start = i * chunkSize;
      const end = i === this.NUM_CHUNKS - 1 
        ? totalBytes - 1 
        : (i + 1) * chunkSize - 1;

      chunks.push({
        index: i,
        start,
        end,
        downloadedBytes: 0,
        retries: 0,
        completed: false,
      });
    }

    return chunks;
  }

  private calculateTotalProgress(): number {
    return this.chunks.reduce((total, chunk) => total + chunk.downloadedBytes, 0);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  pause(): void {
    log.info(`[DirectEngine] Pausing (Aborting) download...`);
    this.abortController?.abort();
  }

  stop(): void {
    log.info(`[DirectEngine] Stopping download...`);
    this.abortController?.abort();
  }
}
