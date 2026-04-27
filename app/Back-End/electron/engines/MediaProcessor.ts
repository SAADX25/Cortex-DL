import { spawn } from 'node:child_process';
import log from 'electron-log';
import { getBinaryPath } from '../paths';

export class MediaProcessor {
  async merge(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
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

      proc.stdout.on('data', (data: Buffer) => {
        log.info(`[MediaProcessor] FFmpeg stdout: ${data.toString().trim()}`);
      });

      proc.stderr.on('data', (data: Buffer) => {
        log.warn(`[MediaProcessor] FFmpeg stderr: ${data.toString().trim()}`);
      });

      proc.on('close', (code: number) => {
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

  /**
    * Converts a media file from one format/container to another.
    */
  async convert(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = getBinaryPath('ffmpeg');
      const args = ['-y', '-threads', '2', '-i', inputPath, outputPath];

      log.info(`[MediaProcessor] Converting: ${inputPath} -> ${outputPath}`);

      const proc = spawn(ffmpeg, args, { windowsHide: true });
      proc.on('close', (code: number) => {
        if (code === 0) {
          log.info(`[MediaProcessor] Converted successfully: ${outputPath}`);
          resolve();
        } else {
          reject(new Error(`FFmpeg conversion failed: code ${code}`));
        }
      });
    });
  }

  /**
   * Extracts the FPS of a video file using ffmpeg.
   */
  async getFps(filePath: string): Promise<number | null> {
    return new Promise((resolve) => {
      const ffmpeg = getBinaryPath('ffmpeg');
      const args = ['-i', filePath];

      log.info(`[MediaProcessor] Running ffmpeg for FPS: ${ffmpeg} ${args.join(' ')}`);
      
      const proc = spawn(ffmpeg, args, { windowsHide: true });
      let output = '';

      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.on('close', () => {
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
        log.error(`[MediaProcessor] ffmpeg spawn error: ${err.message}`);
        resolve(null);
      });
    });
  }
}
