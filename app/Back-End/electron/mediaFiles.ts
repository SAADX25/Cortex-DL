import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DownloadTask, TargetFormat } from './types'
import { AUDIO_FORMATS, VIDEO_FORMATS } from './types'

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

export function isTargetFormat(value: string): value is TargetFormat {
  return supported.has(value.toLowerCase())
}
