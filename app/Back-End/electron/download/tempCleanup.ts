// Safe temporary fragment cleanup under <task.directory>/.cortex_temp/<task.id> with symlink traversal checks
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DownloadTask } from '../types'

export async function removeTaskTempFragments(task: DownloadTask): Promise<void> {
  if (!path.isAbsolute(task.directory) || !/^[\w-]+$/.test(task.id)) return
  const root = path.resolve(task.directory, '.cortex_temp')
  const owned = path.resolve(root, task.id)
  if (path.dirname(owned) !== root) throw new Error('Unsafe task temp directory')

  // Verify .cortex_temp is a real directory under task.directory before recursive deletion to prevent symlink traversal.
  const rootStat = await fs.lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!rootStat) return
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Unsafe temp root')
  const realRoot = await fs.realpath(root)
  const realDirectory = await fs.realpath(task.directory)
  if (path.relative(realDirectory, realRoot) !== '.cortex_temp') {
    throw new Error('Unsafe temp root')
  }
  await fs.rm(owned, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })

  await fs.rmdir(root).catch((error: NodeJS.ErrnoException) => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code || '')) throw error
  })
}
