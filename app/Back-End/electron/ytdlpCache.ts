import os from 'node:os'
import path from 'node:path'
import { readdir, stat, unlink } from 'node:fs/promises'

const directory = path.join(os.tmpdir(), 'cortexdl-ytdlp-cache')
let lastCleanup = 0

/** Isolated yt-dlp cache, periodically pruned, never disabled on metadata requests. */
export function ytdlpCacheArgs(): string[] {
  if (Date.now() - lastCleanup > 3600000) {
    lastCleanup = Date.now()
    void prune(directory).catch(() => {})
  }
  return ['--cache-dir', directory]
}

async function prune(root: string): Promise<void> {
  const entries: { file: string; size: number; mtimeMs: number }[] = []
  const walk = async (folder: string): Promise<void> => {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name)
      if (item.isDirectory()) await walk(file)
      else if (item.isFile()) {
        const info = await stat(file).catch(() => null)
        if (info) entries.push({ file, size: info.size, mtimeMs: info.mtimeMs })
      }
    }
  }
  await walk(root)
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  let size = 0
  for (const entry of entries) {
    size += entry.size
    const age = Date.now() - entry.mtimeMs
    if (age > 30 * 86400000 || (size > 64 * 1024 * 1024 && age > 60000)) await unlink(entry.file).catch(() => {})
  }
}
