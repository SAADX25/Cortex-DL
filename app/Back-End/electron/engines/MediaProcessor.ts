import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import log from 'electron-log';
import { getBinaryPath } from '../paths';

/**
 * Time allowed for a bare `ffmpeg -i` probe (getFps) before we kill it.
 * Without this, a hung/interactive ffmpeg process (e.g. waiting on stdin)
 * would leak forever and its caller's promise would never settle.
 */
const FFMPEG_PROBE_TIMEOUT_MS = 15_000;

/** Caps unbounded string growth if a process is unexpectedly verbose or hangs. */
const MAX_OUTPUT_BYTES = 256 * 1024;

export class MediaProcessor {
  /**
   * Tracks every ffmpeg child process currently in flight for this instance,
   * so callers have a deterministic way to tear them all down (e.g. on app
   * quit or task cancellation) instead of leaving orphaned processes behind
   * — one of the "child-process lifecycle holes" this fixes.
   */
  private readonly activeProcesses = new Set<ChildProcessWithoutNullStreams>();

  /** Kills every ffmpeg process currently tracked by this instance. */
  killAll(): void {
    for (const proc of this.activeProcesses) {
      try { proc.kill(); } catch { /* already dead */ }
    }
    this.activeProcesses.clear();
  }

  async merge(videoPath: string, audioPath: string, outputPath: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = getBinaryPath('ffmpeg');
      const args = [
        '-y',
        '-threads', '2',
        '-i', videoPath,
        '-i', audioPath,
        '-c', 'copy',
        '-map', '0:v:0',
        '-map', '1:a:0',
        outputPath
      ];

      log.info(`[MediaProcessor] Merging with FFmpeg: ${ffmpeg} ${args.join(' ')}`);

      const proc = spawn(ffmpeg, args, { windowsHide: true });
      this.activeProcesses.add(proc);

      // Previously there was no 'error' handler here at all: if spawn
      // itself failed (e.g. missing binary), this promise would hang
      // forever — a genuine lifecycle hole, not just a leak.
      let settled = false;
      const onAbort = () => { try { proc.kill(); } catch { /* already dead */ } };
      signal?.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        proc.stdout.removeAllListeners();
        proc.stderr.removeAllListeners();
        this.activeProcesses.delete(proc);
      };

      proc.stdout.on('data', (data: Buffer) => {
        log.info(`[MediaProcessor] FFmpeg stdout: ${data.toString().trim()}`);
      });

      proc.stderr.on('data', (data: Buffer) => {
        log.warn(`[MediaProcessor] FFmpeg stderr: ${data.toString().trim()}`);
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        log.error(`[MediaProcessor] FFmpeg spawn error:`, err);
        reject(err);
      });

      proc.on('close', (code: number) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (code === 0) {
          log.info(`[MediaProcessor] Merged successfully: ${outputPath}`);
          resolve();
        } else {
          log.error(`[MediaProcessor] FFmpeg failed with code ${code}`);
          reject(new Error(`FFmpeg merge failed with code ${code}`));
        }
      });
    });
  }

  async convert(inputPath: string, outputPath: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = getBinaryPath('ffmpeg');
      const args = ['-y', '-threads', '2', '-i', inputPath, outputPath];

      log.info(`[MediaProcessor] Converting: ${inputPath} -> ${outputPath}`);

      const proc = spawn(ffmpeg, args, { windowsHide: true });
      this.activeProcesses.add(proc);

      // As with merge(): this previously had no 'error' handler, so a
      // spawn failure would hang the promise forever instead of rejecting.
      let settled = false;
      const onAbort = () => { try { proc.kill(); } catch { /* already dead */ } };
      signal?.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        proc.stdout.removeAllListeners();
        proc.stderr.removeAllListeners();
        this.activeProcesses.delete(proc);
      };

      // Drain stdout/stderr so a chatty ffmpeg process can't apply
      // backpressure and stall — we don't need the content here.
      proc.stdout.on('data', () => { /* drained intentionally */ });
      proc.stderr.on('data', () => { /* drained intentionally */ });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        log.error(`[MediaProcessor] FFmpeg spawn error:`, err);
        reject(err);
      });

      proc.on('close', (code: number) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (code === 0) {
          log.info(`[MediaProcessor] Converted successfully: ${outputPath}`);
          resolve();
        } else {
          reject(new Error(`FFmpeg conversion failed: code ${code}`));
        }
      });
    });
  }

  async getFps(filePath: string): Promise<number | null> {
    return new Promise((resolve) => {
      const ffmpeg = getBinaryPath('ffmpeg');
      const args = ['-i', filePath];

      log.info(`[MediaProcessor] Running ffmpeg for FPS: ${ffmpeg} ${args.join(' ')}`);

      const proc = spawn(ffmpeg, args, { windowsHide: true });
      this.activeProcesses.add(proc);
      let output = '';
      let settled = false;

      // Previously there was no timeout: a hung ffmpeg process (e.g.
      // waiting indefinitely on a malformed/streaming input) would leak
      // the child process and block this promise forever.
      const timeoutTimer = setTimeout(() => {
        if (settled) return;
        log.warn(`[MediaProcessor] ffmpeg probe timed out after ${FFMPEG_PROBE_TIMEOUT_MS}ms, killing`);
        try { proc.kill(); } catch { /* already dead */ }
      }, FFMPEG_PROBE_TIMEOUT_MS);
      timeoutTimer.unref?.();

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        proc.stdout.removeAllListeners();
        proc.stderr.removeAllListeners();
        this.activeProcesses.delete(proc);
      };

      const appendOutput = (chunk: Buffer) => {
        output += chunk.toString();
        // Bound growth in case ffmpeg is unexpectedly verbose or hangs
        // while still emitting output — avoids unbounded memory retention.
        if (output.length > MAX_OUTPUT_BYTES) {
          output = output.slice(-MAX_OUTPUT_BYTES);
        }
      };

      proc.stdout.on('data', appendOutput);
      proc.stderr.on('data', appendOutput);

      proc.on('close', () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (output) {
          try {
            const match = output.match(/(\d+(?:\.\d+)?)\s*fps/i);
            if (match && match[1]) {
              const fps = Math.round(parseFloat(match[1]));
              log.info(`[MediaProcessor] Evaluated FPS from ffmpeg output: ${fps}`);
              resolve(fps);
              return;
            }
            log.warn(`[MediaProcessor] Could not find FPS pattern in ffmpeg output.`);
          } catch (err) {
            log.warn(`[MediaProcessor] Failed to parse FPS: ${err}`);
          }
        } else {
          log.warn(`[MediaProcessor] ffmpeg had no output`);
        }
        resolve(null);
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        log.error(`[MediaProcessor] ffmpeg spawn error: ${err.message}`);
        resolve(null);
      });
    });
  }
}
