import { dialog, ipcMain } from 'electron'
import path from 'node:path'
import type { IpcDependencies } from '../ipc/handlers'
import type { SubtitleMergeFormat } from '../../../Shared/downloadSubtitles'
import { listDownloadSubtitles, mergeDownloadSubtitle } from './downloadMerge'

const jobs = new Map<string, { controller: AbortController; done: Promise<unknown>; processing: boolean }>()
let stopping = false
export function registerDownloadSubtitleIpc({ getWin, getDownloads }: IpcDependencies): void {
  const getVideo = (id: string) => {
    const task = getDownloads()?.get(id)
    if (!task || task.status !== 'completed' || !task.filePath || !/\.(mp4|mkv|webm|mov|avi|m4v|ogv)$/i.test(task.filePath)) throw new Error('SELECT_COMPLETED_VIDEO')
    return task.filePath
  }
  ipcMain.handle('cortexdl:subtitle-files:list', async (_event, id: string) => listDownloadSubtitles(getVideo(id)))
  ipcMain.handle('cortexdl:subtitle-files:cancel', (_event, id: string) => { jobs.get(id)?.controller.abort() })
  ipcMain.handle('cortexdl:subtitle-files:merge', async (event, id: string, fileName: string, format: SubtitleMergeFormat) => {
    if (stopping || jobs.has(id)) throw new Error('SUBTITLE_MERGE_BUSY')
    const media = getVideo(id), win = getWin()
    if (!win) return null
    const controller = new AbortController(), job = { controller, done: Promise.resolve() as Promise<unknown>, processing: false }
    jobs.set(id, job)
    const onDestroyed = () => controller.abort()
    event.sender.once('destroyed', onDestroyed)
    job.done = (async () => {
      if (!(await listDownloadSubtitles(media)).some(file => file.fileName === fileName)) throw new Error('SUBTITLE_FILE_UNAVAILABLE')
      controller.signal.throwIfAborted()
      const result = await dialog.showSaveDialog(win, { defaultPath: path.join(path.dirname(media), `${path.parse(media).name}.subtitled.${format}`), filters: [{ name: format.toUpperCase(), extensions: [format] }] })
      if (result.canceled || !result.filePath || controller.signal.aborted) return null
      job.processing = true
      await mergeDownloadSubtitle(media, fileName, result.filePath, format, controller.signal)
      return result.filePath
    })()
    try { return await job.done } catch (error) { if (controller.signal.aborted) return null; throw error }
    finally { if (jobs.get(id) === job) jobs.delete(id); event.sender.removeListener('destroyed', onDestroyed) }
  })
}
export async function stopDownloadSubtitleMerges(): Promise<void> {
  stopping = true
  for (const job of jobs.values()) job.controller.abort()
  await Promise.allSettled([...jobs.values()].filter(job => job.processing).map(job => job.done))
}
