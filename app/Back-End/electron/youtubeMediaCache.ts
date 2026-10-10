import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DownloadTask } from './types'

/** Only a successful yt-dlp exit creates this receipt; a playable partial is insufficient. */
export async function rememberCompletedYouTubeMedia(task: DownloadTask, candidate: string): Promise<void> {
  if (path.dirname(path.resolve(candidate)) !== path.resolve(task.directory)) throw new Error('Media cache must be attempt-owned')
  const stat = await fs.lstat(candidate)
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Media cache is not a regular file')
  await fs.writeFile(path.join(task.directory, `${task.id}.media-ready.json`), JSON.stringify({ file: path.basename(candidate), size: stat.size }), { mode: 0o600 })
}

export async function findCompletedYouTubeMedia(task: DownloadTask): Promise<string | null> {
  try {
    const receipt = JSON.parse(await fs.readFile(path.join(task.directory, `${task.id}.media-ready.json`), 'utf8'))
    if (typeof receipt.file !== 'string' || path.basename(receipt.file) !== receipt.file || !receipt.file.startsWith(`${task.id}.`)
      || !/\.(mkv|mp4|webm)$/.test(receipt.file)) return null
    const file = path.join(task.directory, receipt.file)
    const stat = await fs.lstat(file)
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size === receipt.size ? file : null
  } catch { return null }
}
