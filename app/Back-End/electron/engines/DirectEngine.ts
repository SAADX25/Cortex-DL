import type { IEngine } from './IEngine';
import type { DownloadTask, EngineContext } from '../types';
import log from 'electron-log';
import axios from 'axios';
import { createWriteStream } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
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

/** Time allowed for the response headers to arrive. */
const RESPONSE_TIMEOUT_MS = 60_000;

/**
 * Time a connection may deliver zero bytes before we consider it dead.
 * axios' `timeout` only covers the header phase, so a socket that opens and
 * then goes silent would otherwise hang the whole download forever.
 */
const STALL_TIMEOUT_MS = 60_000;
const STALL_CHECK_INTERVAL_MS = 5_000;

/** Minimum interval between progress IPC/DB notifications. */
const PROGRESS_INTERVAL_MS = 150;

/** Interval between chunk-state snapshots while a chunk is streaming. */
const CHUNK_PERSIST_INTERVAL_MS = 5_000;

/** Raised when a server answers a Range request with a full 200 body. */
class RangeUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeUnsupportedError';
  }
}

/** Raised when the download was torn down deliberately (pause/cancel/failure). */
class DownloadAbortedError extends Error {
  constructor() {
    super('Download aborted');
    this.name = 'DownloadAbortedError';
  }
}

/**
 * Prepared once instead of on every download — `db.prepare()` compiles SQL
 * synchronously on the main thread.
 */
let directConnectionsStmt: ReturnType<typeof db.prepare> | null = null;

/**
 * Read the user-configurable number of parallel connections from the DB.
 * Falls back to 8 if not set or invalid.
 */
function getNumChunksFromSettings(): number {
  try {
    if (!directConnectionsStmt) {
      directConnectionsStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    }
    const row = directConnectionsStmt.get('directConnections') as { value?: string } | undefined;
    if (row?.value) {
      const parsed = parseInt(row.value, 10);
      if (parsed >= 1 && parsed <= 32) return parsed;
    }
  } catch { /* use default */ }
  return 8;
}

export class DirectEngine implements IEngine {
  private abortController: AbortController | null = null;
  private readonly MAX_RETRIES = 3;
  private readonly MIN_FILE_SIZE_FOR_CHUNKING = 5 * 1024 * 1024; // 5 MB
  private chunks: ChunkInfo[] = [];
  private lastProgressUpdate = 0;
  private lastProgressUpdateBytes = 0;
  private numChunks = 8;
  /** First real (non-abort) failure across all parallel chunks. */
  private failure: unknown = null;
  /** Set only when the user paused or cancelled, never by an internal abort. */
  private stopRequested = false;

  async download(task: DownloadTask, context?: EngineContext): Promise<void> {
    log.info(`[DirectEngine] Starting download: ${task.url}`);

    this.failure = null;
    this.stopRequested = false;
    this.numChunks = getNumChunksFromSettings();
    this.adoptController(new AbortController(), context);

    try {
      // ── HEAD request to probe server capabilities ──────────────────
      let supportsRanges = task.supportsRanges ?? false;
      let totalBytes: number | null = task.totalBytes ?? null;

      // Only do HEAD if we don't already have cached info from a previous attempt
      if (totalBytes == null || totalBytes <= 0) {
        try {
          const headResponse = await axios.head(task.url, {
            timeout: 10000,
            signal: this.abortController?.signal,
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
          if (this.isAbort(err)) throw err;
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
        try {
          await this.downloadWithChunking(task, totalBytes, context);
        } catch (error) {
          if (!(error instanceof RangeUnsupportedError) || this.stopRequested) throw error;

          // The server advertised Range support but did not honour it. Every
          // chunk is now suspect, so discard the output and restart as a plain
          // single stream on a fresh controller (the old one is aborted).
          log.warn(
            `[DirectEngine] Task ${task.id}: ${error.message} — restarting as a single stream`
          );
          await this.discardOutput(task);
          this.adoptController(new AbortController(), context);
          await this.downloadSingleStream(task, context);
        }
      } else {
        await this.downloadSingleStream(task, context);
      }

      // ── Cleanup resume state on success ────────────────────────────
      task.resumeChunks = undefined;
      task.supportsRanges = undefined;

      log.info(`[DirectEngine] Download completed for task ${task.id}`);

    } catch (error) {
      if (this.stopRequested || this.isAbort(error)) {
        // User paused — persist chunk state for resume
        this.persistChunkState(task);
        log.warn(`[DirectEngine] Task ${task.id} download aborted — chunk state saved`);
        throw new Error('Download aborted');
      }

      log.error(`[DirectEngine] Task ${task.id} failed:`, error);
      throw error;
    } finally {
      // Unconditionally tear down anything still in flight. A partially failed
      // chunked download must never leave sibling sockets writing to the file
      // after the task has been reported as finished.
      const controller = this.abortController;
      controller?.abort();
      this.abortController = null;
      if (context && context.runtime.abortController === controller) {
        context.runtime.abortController = null;
      }
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

    if (task.downloadedBytes > 0) {
      try {
        const stat = await fsPromises.stat(task.filePath);
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

    const response = await axios<Readable>({
      method: 'get',
      url: task.url,
      responseType: 'stream',
      signal: this.abortController?.signal,
      timeout: RESPONSE_TIMEOUT_MS,
      maxRedirects: 5,
      headers,
    });

    // If server doesn't honor Range (returns 200 instead of 206), start fresh
    if (startByte > 0 && response.status !== 206) {
      log.warn(`[DirectEngine] Task ${task.id}: Server returned ${response.status} instead of 206 — restarting from scratch`);
      startByte = 0;
      writeFlags = 'w';
      task.downloadedBytes = 0;
    }

    const contentLength = parseInt(String(response.headers['content-length'] ?? '0'), 10);
    if (contentLength > 0) {
      // Content-Length in a 206 response counts only the remaining bytes.
      task.totalBytes = startByte > 0 ? startByte + contentLength : contentLength;
    }

    if (startByte === 0) {
      task.downloadedBytes = 0;
    }

    this.lastProgressUpdate = nowMs();
    this.lastProgressUpdateBytes = task.downloadedBytes;

    const stream = response.data;
    let lastActivityAtMs = nowMs();
    const stallTimer = this.startStallWatchdog(
      stream,
      () => lastActivityAtMs,
      `Task ${task.id} single stream`
    );

    const progressStream = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        task.downloadedBytes += chunk.length;
        lastActivityAtMs = nowMs();

        const now = nowMs();
        const bytesSinceLast = task.downloadedBytes - this.lastProgressUpdateBytes;
        if (now - this.lastProgressUpdate > 100 || bytesSinceLast > 1024 * 1024) {
          this.reportProgress(task, context);
          this.lastProgressUpdateBytes = task.downloadedBytes;
        }
        callback(null, chunk);
      }
    });

    try {
      await pipeline(stream, progressStream, createWriteStream(task.filePath, { flags: writeFlags }));
    } finally {
      clearInterval(stallTimer);
      if (!stream.destroyed) stream.destroy();
    }
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
    const resumed = await this.buildResumeChunks(task, totalBytes);

    if (resumed) {
      const incomplete = resumed.filter(c => !c.completed).length;
      log.info(
        `[DirectEngine] Task ${task.id}: RESUMING — ` +
        `${resumed.length} total chunks, ${incomplete} remaining`
      );
      this.chunks = resumed;
      task.downloadedBytes = this.calculateTotalProgress();
    } else {
      // FRESH path — preallocate the file and create chunks
      log.info(
        `[DirectEngine] Task ${task.id}: Starting FRESH ${this.numChunks}-chunk parallel download`
      );

      const preallocate = await fsPromises.open(task.filePath, 'w');
      try {
        await preallocate.truncate(totalBytes);
      } finally {
        await preallocate.close();
      }

      this.chunks = this.createChunks(totalBytes);
      task.downloadedBytes = 0;
      task.resumeChunks = undefined;
    }

    log.info(`[DirectEngine] Task ${task.id}: ${this.chunks.length} chunks configured`);

    this.lastProgressUpdate = nowMs();
    this.lastProgressUpdateBytes = task.downloadedBytes;

    // Persist initial chunk state
    this.persistChunkState(task);

    const pending = this.chunks.filter(c => !c.completed);
    if (pending.length === 0) {
      log.info(`[DirectEngine] Task ${task.id}: All chunks already complete!`);
      return;
    }

    // One shared descriptor for every chunk. Each chunk writes at an explicit
    // offset (pwrite), so there is no shared file cursor and no need for N
    // independent write streams contending over the same output file.
    const handle = await fsPromises.open(task.filePath, 'r+');
    let outcomes: PromiseSettledResult<void>[] = [];

    try {
      const inFlight = pending.map((chunk) =>
        this.downloadChunkWithRetry(task, chunk, handle, context).catch((err: unknown) => {
          // The first genuine failure immediately tears down every sibling
          // request so nothing keeps streaming behind a reported error.
          if (this.failure == null && !this.isAbort(err)) this.failure = err;
          this.abortController?.abort();
          throw err;
        })
      );

      // allSettled (not all): we must wait for every socket to finish before
      // closing the descriptor or touching the file on disk.
      outcomes = await Promise.allSettled(inFlight);
    } finally {
      await handle.close().catch((err) => {
        log.warn(`[DirectEngine] Task ${task.id}: Failed to close file handle:`, err);
      });
    }

    if (this.failure != null) {
      const failure = this.failure;
      if (!(failure instanceof RangeUnsupportedError)) {
        // Every write has settled and the descriptor is closed, so the partial
        // output can now be removed safely.
        await this.discardOutput(task);
      }
      throw failure;
    }

    if (this.stopRequested || this.abortController?.signal.aborted) {
      throw new DownloadAbortedError();
    }

    const rejected = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected');
    if (rejected) throw rejected.reason;

    const incomplete = this.chunks.filter(c => !c.completed);
    if (incomplete.length > 0) {
      throw new Error(
        `Not all chunks downloaded completely (${incomplete.length}/${this.chunks.length} incomplete)`
      );
    }

    log.info(
      `[DirectEngine] Task ${task.id}: All ${this.chunks.length} chunks completed successfully`
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHUNK DOWNLOAD WITH RETRY
  // ═══════════════════════════════════════════════════════════════════

  private async downloadChunkWithRetry(
    task: DownloadTask,
    chunk: ChunkInfo,
    handle: FileHandle,
    context?: EngineContext
  ): Promise<void> {
    while (chunk.retries < this.MAX_RETRIES) {
      try {
        await this.downloadChunk(task, chunk, handle, context);
        chunk.completed = true;

        // Persist chunk completion immediately
        this.persistChunkState(task);

        log.info(
          `[DirectEngine] Task ${task.id}: Chunk ${chunk.index + 1}/${this.chunks.length} ` +
          `completed (${this.formatBytes(chunk.start)}-${this.formatBytes(chunk.end)})`
        );
        return;
      } catch (error: unknown) {
        // Don't retry on abort, and never retry a server that ignores Range.
        if (this.isAbort(error) || error instanceof RangeUnsupportedError) {
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
    handle: FileHandle,
    context?: EngineContext
  ): Promise<void> {
    const signal = this.abortController?.signal;
    if (signal?.aborted) throw new DownloadAbortedError();

    // Calculate the actual start position (resume within a chunk)
    const resumeStart = chunk.start + chunk.downloadedBytes;
    const expectedBytes = chunk.end - resumeStart + 1;

    if (expectedBytes <= 0) {
      // Chunk already fully downloaded
      chunk.completed = true;
      return;
    }

    const response = await axios<Readable>({
      method: 'get',
      url: task.url,
      headers: {
        'Range': `bytes=${resumeStart}-${chunk.end}`,
      },
      responseType: 'stream',
      signal,
      timeout: RESPONSE_TIMEOUT_MS,
      maxRedirects: 5,
    });

    // A 200 here means the body is the *whole* file, not our slice. Writing it
    // at `resumeStart` would silently corrupt the output.
    if (response.status !== 206) {
      response.data.destroy();
      throw new RangeUnsupportedError(
        `server answered ${response.status} to a Range request`
      );
    }

    const stream = response.data;
    let position = resumeStart;
    let lastActivityAtMs = nowMs();
    let lastChunkSaveAt = nowMs();

    const stallTimer = this.startStallWatchdog(
      stream,
      () => lastActivityAtMs,
      `Task ${task.id} chunk ${chunk.index + 1}`
    );

    try {
      for await (const piece of stream) {
        const buffer = piece as Buffer;
        if (signal?.aborted) throw new DownloadAbortedError();

        // Positional write against the shared descriptor. Awaiting each write
        // gives natural backpressure and keeps `chunk.downloadedBytes` exactly
        // in step with the bytes actually on disk, which is what resume needs.
        await handle.write(buffer, 0, buffer.length, position);

        position += buffer.length;
        chunk.downloadedBytes += buffer.length;
        lastActivityAtMs = nowMs();

        // Update total progress
        task.downloadedBytes = this.calculateTotalProgress();

        const now = nowMs();
        if (now - this.lastProgressUpdate > PROGRESS_INTERVAL_MS) {
          this.reportProgress(task, context);
        }

        // Periodically persist chunk state
        if (now - lastChunkSaveAt > CHUNK_PERSIST_INTERVAL_MS) {
          this.persistChunkState(task);
          if (context?.saveState) context.saveState();
          lastChunkSaveAt = now;
        }
      }
    } finally {
      clearInterval(stallTimer);
      if (!stream.destroyed) stream.destroy();
    }

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

  /**
   * Installs our abort controller and publishes it on the shared task runtime,
   * so `DownloadManager.delete()` / `pauseAll()` can tear the download down
   * even when this engine instance is no longer registered with the manager.
   */
  private adoptController(controller: AbortController, context?: EngineContext): void {
    this.abortController = controller;
    if (!context) return;

    const previous = context.runtime.abortController;
    if (previous && previous !== controller) previous.abort();
    context.runtime.abortController = controller;
  }

  /**
   * Destroys `stream` once it has been silent for longer than STALL_TIMEOUT_MS.
   * Returns the interval handle, which the caller must clear.
   */
  private startStallWatchdog(
    stream: Readable,
    getLastActivityAtMs: () => number,
    label: string
  ): ReturnType<typeof setInterval> {
    return setInterval(() => {
      if (nowMs() - getLastActivityAtMs() < STALL_TIMEOUT_MS) return;
      log.warn(`[DirectEngine] ${label} stalled for ${STALL_TIMEOUT_MS}ms — dropping connection`);
      stream.destroy(new Error(`${label} stalled for ${STALL_TIMEOUT_MS}ms`));
    }, STALL_CHECK_INTERVAL_MS);
  }

  private reportProgress(task: DownloadTask, context?: EngineContext): void {
    this.lastProgressUpdate = nowMs();

    if (context?.sendUpdate) {
      context.sendUpdate(task);
      return;
    }

    const progress = task.totalBytes && task.totalBytes > 0
      ? (task.downloadedBytes / task.totalBytes) * 100
      : 0;
    log.info(
      `[DirectEngine] Task ${task.id} Progress: ${progress.toFixed(2)}% ` +
      `(${this.formatBytes(task.downloadedBytes)}/${this.formatBytes(task.totalBytes || 0)})`
    );
  }

  private isAbort(error: unknown): boolean {
    if (error instanceof DownloadAbortedError) return true;
    if (axios.isCancel(error)) return true;
    const name = (error as { name?: string } | null | undefined)?.name;
    const code = (error as { code?: string } | null | undefined)?.code;
    return name === 'CanceledError' || name === 'AbortError' || code === 'ERR_CANCELED';
  }

  /** Removes the partial output file and clears any resume state. */
  private async discardOutput(task: DownloadTask): Promise<void> {
    this.chunks = [];
    task.resumeChunks = undefined;
    task.downloadedBytes = 0;
    await fsPromises.unlink(task.filePath).catch(() => {
      // File may not exist yet
    });
  }

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
   * Rebuilds chunk state from `task.resumeChunks`, but only when it is provably
   * still valid for this file: the preallocated output must exist at exactly
   * `totalBytes`, and the saved ranges must tile that size without gaps or
   * overlaps. Anything else means the remote file changed (or the state is
   * corrupt), in which case resuming would produce a broken output — so we
   * return null and let the caller start fresh.
   */
  private async buildResumeChunks(
    task: DownloadTask,
    totalBytes: number
  ): Promise<ChunkInfo[] | null> {
    const saved = task.resumeChunks;
    if (!saved || saved.length === 0) return null;

    let fileSize: number;
    try {
      fileSize = (await fsPromises.stat(task.filePath)).size;
    } catch {
      return null;
    }

    if (fileSize !== totalBytes) {
      log.warn(
        `[DirectEngine] Task ${task.id}: Discarding resume state — ` +
        `file is ${fileSize}B but remote reports ${totalBytes}B`
      );
      return null;
    }

    const ordered = [...saved].sort((a, b) => a.start - b.start);
    let expectedStart = 0;

    for (const c of ordered) {
      const size = c.end - c.start + 1;
      if (
        c.start !== expectedStart ||
        size <= 0 ||
        c.end >= totalBytes ||
        c.downloaded < 0 ||
        c.downloaded > size
      ) {
        log.warn(`[DirectEngine] Task ${task.id}: Discarding malformed resume state`);
        return null;
      }
      expectedStart = c.end + 1;
    }

    if (expectedStart !== totalBytes) {
      log.warn(
        `[DirectEngine] Task ${task.id}: Discarding resume state — ` +
        `chunks cover ${expectedStart}B of ${totalBytes}B`
      );
      return null;
    }

    return ordered.map((c, i) => {
      const size = c.end - c.start + 1;
      return {
        index: i,
        start: c.start,
        end: c.end,
        downloadedBytes: c.downloaded,
        retries: 0,
        completed: c.completed || c.downloaded >= size,
      };
    });
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
    this.stopRequested = true;
    this.abortController?.abort();
  }

  stop(): void {
    log.info(`[DirectEngine] Stopping download...`);
    this.stopRequested = true;
    this.abortController?.abort();
  }
}
