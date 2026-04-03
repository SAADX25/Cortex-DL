import { spawn } from 'node:child_process';
import log from 'electron-log';
import { getBinaryPath } from '../paths';

/**
 * MediaProcessor: A separate utility for merging video+audio or format conversion.
 * It strictly uses FFmpeg.
 */
export class MediaProcessor {
  /**
    * Merges video and audio files into a single output container.
    * Returns after FFmpeg completes.
    */
  async merge(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = getBinaryPath('ffmpeg');
      const args = [
        '-y',
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
      const args = ['-y', '-i', inputPath, outputPath];

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
}
