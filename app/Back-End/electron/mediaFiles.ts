import { ensureEnginesReady, engineExecutionFailed } from './engineReadiness'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import type { DownloadTask, VideoFormat } from './types'
import { AUDIO_FORMATS, VIDEO_FORMATS } from './types'
import type { MediaProbe } from './audioFormats'
import { matchesMediaFormat } from './mediaFormatRegistry'
import { getBinaryPath } from './paths'

const supported = new Set<string>([...AUDIO_FORMATS, ...VIDEO_FORMATS])

export function isSupportedMediaPath(filePath: string): boolean {
  return supported.has(path.extname(filePath).slice(1).toLowerCase())
}

export async function findTaskMediaFile(task: DownloadTask, detected: string | null): Promise<string | null> {
  if (detected && path.dirname(detected) === task.directory &&
      path.basename(detected).startsWith(`${task.id}.`) && isSupportedMediaPath(detected) &&
      await fs.stat(detected).then(s => s.isFile() && s.size > 0).catch(() => false)) return detected
  const files = await fs.readdir(task.directory).catch(() => [])
  for (const name of files) {
    if (!name.startsWith(`${task.id}.`) || !isSupportedMediaPath(name)) continue
    const filePath = path.join(task.directory, name)
    if (await fs.stat(filePath).then(s => s.isFile() && s.size > 0).catch(() => false)) return filePath
  }
  return null
}

export function matchesVideoFormat(format: VideoFormat, probe: MediaProbe): boolean {
  return matchesMediaFormat(format, probe)
}

/** Probe the actual bytes; an extension and a positive size are insufficient. */
export async function probeMediaFile(
  filePath: string,
  track?: (child: ChildProcessWithoutNullStreams | null) => void,
  signal?: AbortSignal,
): Promise<MediaProbe> {
  signal?.throwIfAborted()
  await ensureEnginesReady(['ffprobe'])
  signal?.throwIfAborted()
  const stat = await fs.stat(filePath)
  signal?.throwIfAborted()
  if (!stat.isFile() || stat.size <= 0) throw new Error('Media output is empty')
  const child = spawn(getBinaryPath('ffprobe'), [
    '-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,duration,width,height,avg_frame_rate,r_frame_rate:stream_tags=language,title,handler_name:stream_disposition=attached_pic',
    '-of', 'json', filePath,
  ], { windowsHide: true, detached: false })
  child.on('error', error => engineExecutionFailed('ffprobe', error))
  track?.(child)
  const onAbort = () => { child.kill() }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
    if (output.length > 1024 * 1024) child.kill()
  })
  child.stderr.resume()
  const timeout = setTimeout(() => child.kill(), 15_000)
  try {
    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', code => resolve(code ?? 1))
      child.on('error', () => resolve(1))
    })
    signal?.throwIfAborted()
    if (exitCode !== 0 || !output || output.length > 1024 * 1024) {
      throw new Error('ffprobe could not validate the media output')
    }
    return JSON.parse(output) as MediaProbe
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
    child.stdout.removeAllListeners()
    child.stderr.removeAllListeners()
    track?.(null)
  }
}
