import type { IEngine } from './IEngine';
import type { DownloadTask, EngineContext } from '../types';
import log from 'electron-log';
import axios from 'axios';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { nowMs } from '../utils';
import { db } from '../db';

interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  downloadedBytes: number;
  retries: number;
  completed: boolean;
}

/**
 * Read the user-configurable number of parallel connections from the DB.
 * Falls back to 8 if not set or invalid.
 */
function getNumChunksFromSettings(): number {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('directConnections') as { value: string } | undefined
    if (row) {
      const parsed = parseInt(row.value, 10)
      if (parsed >= 1 && parsed <= 32) return parsed
    }
  } catch { /* use default */ }
  return 8
}

export class DirectEngine implements IEngine {
  private abortController: AbortController | null = null;
  private readonly MAX_RETRIES = 3;
  private readonly MIN_FILE_SIZE_FOR_CHUNKING = 5 * 1024 * 1024; // 5 MB
  private chunks: ChunkInfo[] = [];
  private lastProgressUpdate = 0;
  private lastProgressUpdateBytes = 0;
  private numChunks = 8;

  async download(task: DownloadTask, context?: EngineContext): Promise<void> {
    log.info(`[DirectEngine] Starting download: ${task.url}`);
    this.abortController = new AbortController();
    this.numChunks = getNumChunksFromSettings();

    try {
      // ── HEAD request to probe server capabilities ──────────────────
      let supportsRanges = task.supportsRanges ?? false;
      let totalBytes: number | null = task.totalBytes ?? null;

      // Only do HEAD if we don't already have cached info from a previous attempt
      if (totalBytes == null || totalBytes <= 0) {
        try {
          const headResponse = await axios.head(task.url, {
            timeout: 10000,
            signal: this.abortController.signal,
          });

          const contentLength = parseInt(String(headResponse.headers['content-length'] ?? '0'), 10);
          if (contentLength > 0) {
            totalBytes = contentLength;
            supportsRanges =
              (String(headResponse.headers['accept-ranges'] ?? '').toLowerCase() === 'bytes') &&
              contentLength >= this.MIN_FILE_SIZE_FOR_CHUNKING;

            // Cache for future resume attempts
            task.supportsRanges = supportsRanges;

            log.info(
              `[DirectEngine] Task ${task.id}: totalBytes=${totalBytes}, ` +
              `acceptRanges=${supportsRanges}`
            );
          }
        } catch (err: unknown) {
          log.warn(
            `[DirectEngine] Task ${task.id} HEAD request failed, falling back to single stream:`,
            (err as any).message
          );
        }
      }

      // Propagate total bytes to the UI
      if (totalBytes) {
        task.totalBytes = totalBytes;
        if (context?.sendUpdate) context.sendUpdate(task);
      }

      // ── Route to chunked or single-stream download ─────────────────
      if (supportsRanges && totalBytes && totalBytes > 0) {
        await this.downloadWithChunking(task, totalBytes, context);
      } else {
        await this.downloadSingleStream(task, context);
      }

      // ── Cleanup resume state on success ────────────────────────────
      task.resumeChunks = undefined;
      task.supportsRanges = undefined;

      log.info(`[DirectEngine] Download completed for task ${task.id}`);

    } catch (error) {
      if (axios.isCancel(error)) {
        // User paused — persist chunk state for resume
        this.persistChunkState(task);
        log.warn(`[DirectEngine] Task ${task.id} download aborted — chunk state saved`);
        throw new Error('Download aborted');
      } else {
        log.error(`[DirectEngine] Task ${task.id} failed:`, error);
        throw error;
      }
    } finally {
      this.abortController = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SINGLE STREAM (no Range support or small files)
  // ═══════════════════════════════════════════════════════════════════

  private async downloadSingleStream(
    task: DownloadTask,
    context?: EngineContext
  ): Promise<void> {
    // ── Resume support for single-stream downloads ───────────────
    // If the file already exists and we have partial progress,
    // use a Range header to continue from where we left off.
    let startByte = 0;
    let writeFlags: string = 'w'; // default: overwrite

    if (task.downloadedBytes > 0 && existsSync(task.filePath)) {
      try {
        const stat = statSync(task.filePath);
        if (stat.size > 0 && stat.size === task.downloadedBytes) {
          startByte = stat.size;
          writeFlags = 'a'; // append to existing file
          log.info(`[DirectEngine] Task ${task.id}: Resuming single-stream from byte ${startByte}`);
        }
      } catch {
        // File stat failed — start fresh
        startByte = 0;
        writeFlags = 'w';
      }
    }

    const headers: Record<string, string> = {};
    if (startByte > 0) {
      headers['Range'] = `bytes=${startByte}-`;
    }

    const response = await axios({
      method: 'get',
      url: task.url,
      responseType: 'stream',
      signal: this.abortController?.signal,
      timeout: 300000, // 5 minutes
      headers,
    });

    // If server doesn't honor Range (returns 200 instead of 206), start fresh
    if (startByte > 0 && response.status !== 206) {
      log.warn(`[DirectEngine] Task ${task.id}: Server returned ${response.status} instead of 206 — restarting from scratch`);
      startByte = 0;
      writeFlags = 'w';
      task.downloadedBytes = 0;
    }

    const totalBytes = parseInt(String(response.headers['content-length'] ?? '0'), 10);
    if (totalBytes > 0 && startByte === 0) {
      task.totalBytes = totalBytes;
    } else if (totalBytes > 0 && startByte > 0) {
      // Content-Length in a 206 response is the remaining bytes
      task.totalBytes = startByte + totalBytes;
    }

    if (startByte === 0) {
      task.downloadedBytes = 0;
    }

    this.lastProgressUpdate = nowMs();
    this.lastProgressUpdateBytes = task.downloadedBytes;

    const writer = createWriteStream(task.filePath, { flags: writeFlags });

    const progressStream = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        task.downloadedBytes += chunk.length;

        const now = nowMs();

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

  // ═══════════════════════════════════════════════════════════════════
  // CHUNKED DOWNLOAD (parallel multi-connection with resume)
  // ═══════════════════════════════════════════════════════════════════

  private async downloadWithChunking(
    task: DownloadTask,
    totalBytes: number,
    context?: EngineContext
  ): Promise<void> {
    // ── Decide: Resume existing chunks OR start fresh ─────────────
    if (
      task.resumeChunks &&
      task.resumeChunks.length > 0 &&
      existsSync(task.filePath)
    ) {
      // RESUME path — rebuild ChunkInfo from persisted state
      const incomplete = task.resumeChunks.filter(c => !c.completed).length;
      log.info(
        `[DirectEngine] Task ${task.id}: RESUMING — ` +
        `${task.resumeChunks.length} total chunks, ${incomplete} remaining`
      );

      this.chunks = task.resumeChunks.map((c, i) => ({
        index: i,
        start: c.start,
        end: c.end,
        downloadedBytes: c.downloaded,
        retries: 0,
        completed: c.completed,
      }));

      // Recalculate actual downloaded bytes from chunk state
      task.downloadedBytes = this.calculateTotalProgress();
    } else {
      // FRESH path — create new file and chunks
      log.info(
        `[DirectEngine] Task ${task.id}: Starting FRESH ${this.numChunks}-chunk parallel download`
      );

      const fh = await fsPromises.open(task.filePath, 'w');
      await fh.truncate(totalBytes);
      await fh.close();

      this.chunks = this.createChunks(totalBytes);
      task.downloadedBytes = 0;
    }

    log.info(`[DirectEngine] Task ${task.id}: ${this.chunks.length} chunks configured`);

    this.lastProgressUpdate = nowMs();
    this.lastProgressUpdateBytes = task.downloadedBytes;

    // Persist initial chunk state
    this.persistChunkState(task);

    try {
      // ── Download only incomplete chunks in parallel ─────────────
      const incompleteChunks = this.chunks.filter(c => !c.completed);

      if (incompleteChunks.length === 0) {
        log.info(`[DirectEngine] Task ${task.id}: All chunks already complete!`);
        return;
      }

      const downloadPromises = incompleteChunks.map((chunk) =>
        this.downloadChunkWithRetry(task, chunk, context)
      );

      await Promise.all(downloadPromises);

      // Verify all chunks completed
      const allChunksComplete = this.chunks.every(c => c.completed);

      if (!allChunksComplete) {
        throw new Error('Not all chunks downloaded completely');
      }

      log.info(
        `[DirectEngine] Task ${task.id}: All ${this.chunks.length} chunks completed successfully`
      );

    } catch (error) {
      // On abort (pause), chunk state is persisted in the catch block of download()
      // On real error, clean up the file
      if (!this.abortController?.signal.aborted && !axios.isCancel(error)) {
        try {
          await fsPromises.unlink(task.filePath);
          task.resumeChunks = undefined;
        } catch {
          // File may not exist yet
        }
      }
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHUNK DOWNLOAD WITH RETRY
  // ═══════════════════════════════════════════════════════════════════

  private async downloadChunkWithRetry(
    task: DownloadTask,
    chunk: ChunkInfo,
    context?: EngineContext
  ): Promise<void> {
    while (chunk.retries < this.MAX_RETRIES) {
      try {
        await this.downloadChunk(task, chunk, context);
        chunk.completed = true;

        // Persist chunk completion immediately
        this.persistChunkState(task);

        log.info(
          `[DirectEngine] Task ${task.id}: Chunk ${chunk.index + 1}/${this.chunks.length} ` +
          `completed (${this.formatBytes(chunk.start)}-${this.formatBytes(chunk.end)})`
        );
        return;
      } catch (error: unknown) {
        // Don't retry on abort
        if (axios.isCancel(error) || this.abortController?.signal.aborted) {
          throw error;
        }

        chunk.retries++;
        log.warn(
          `[DirectEngine] Task ${task.id}: Chunk ${chunk.index + 1} failed ` +
          `(attempt ${chunk.retries}/${this.MAX_RETRIES}): ${(error as any).message}`
        );

        if (chunk.retries >= this.MAX_RETRIES) {
          throw new Error(
            `Chunk ${chunk.index + 1} failed after ${this.MAX_RETRIES} attempts: ${(error as any).message}`
          );
        }

        // Exponential backoff
        await new Promise(r => setTimeout(r, Math.pow(2, chunk.retries) * 100));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // INDIVIDUAL CHUNK DOWNLOAD
  // ═══════════════════════════════════════════════════════════════════

  private async downloadChunk(
    task: DownloadTask,
    chunk: ChunkInfo,
    context?: EngineContext
  ): Promise<void> {
    if (this.abortController?.signal.aborted) {
      throw new Error('Download aborted');
    }

    // Calculate the actual start position (resume within a chunk)
    const resumeStart = chunk.start + chunk.downloadedBytes;
    const expectedBytes = chunk.end - resumeStart + 1;

    if (expectedBytes <= 0) {
      // Chunk already fully downloaded
      chunk.completed = true;
      return;
    }

    const response = await axios({
      method: 'get',
      url: task.url,
      headers: {
        'Range': `bytes=${resumeStart}-${chunk.end}`,
      },
      responseType: 'stream',
      signal: this.abortController?.signal,
      timeout: 60000, // 1 minute
    });

    let chunkBytesThisSession = 0;
    let lastChunkSaveAt = nowMs();

    const progressStream = new Transform({
      transform: (buffer: Buffer, _encoding, callback) => {
        chunkBytesThisSession += buffer.length;
        chunk.downloadedBytes += buffer.length;

        // Update total progress
        task.downloadedBytes = this.calculateTotalProgress();

        const now = nowMs();

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

        // Periodically persist chunk state (every 5 seconds)
        if (now - lastChunkSaveAt > 5000) {
          this.persistChunkState(task);
          if (context?.saveState) context.saveState();
          lastChunkSaveAt = now;
        }

        callback(null, buffer);
      }
    });

    // Write to the correct position within the file
    await pipeline(
      response.data,
      progressStream,
      createWriteStream(task.filePath, { start: resumeStart, flags: 'r+' })
    );

    // Verify downloaded size
    const totalChunkExpected = chunk.end - chunk.start + 1;
    if (chunk.downloadedBytes !== totalChunkExpected) {
      throw new Error(
        `Chunk ${chunk.index} size mismatch: expected ${totalChunkExpected}, ` +
        `got ${chunk.downloadedBytes}`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private createChunks(totalBytes: number): ChunkInfo[] {
    const chunks: ChunkInfo[] = [];
    const chunkSize = Math.ceil(totalBytes / this.numChunks);

    for (let i = 0; i < this.numChunks; i++) {
      const start = i * chunkSize;
      const end = i === this.numChunks - 1
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

  /**
   * Persist current chunk state into `task.resumeChunks` so it survives
   * pause/resume cycles via the DownloadManager's SQLite serialization.
   */
  private persistChunkState(task: DownloadTask): void {
    if (this.chunks.length === 0) return;
    task.resumeChunks = this.chunks.map(c => ({
      start: c.start,
      end: c.end,
      downloaded: c.downloadedBytes,
      completed: c.completed,
    }));
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
