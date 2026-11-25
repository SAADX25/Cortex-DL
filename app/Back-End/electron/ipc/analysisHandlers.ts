// IPC handlers for URL analysis, trim preview stream resolution, thumbnails, and comment extraction
import { dialog, ipcMain } from 'electron'
import log from 'electron-log'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { isThreadsUrl, normalizeAnalysisUrl, youtubeVideoId } from '../../../Shared/analysisUrl'
import { extractAndSaveComments } from '../commentsExtractor'
import {
  analyzeWithYtdlp,
  assertAnalysisAllowed,
  getDirectStreamUrl,
  getTrimPreviewStreams,
} from '../engines/ytdlpService'
import { analyzeUrlForHls } from '../hls'
import { analysisTiming, fetchBoundedJson, isDirectMedia } from '../services/analysisService'
import {
  analyzeThreadsUrl,
  getThreadsDirectStreamUrl,
  getThreadsPreviewStreams,
} from '../services/threadsService'
import { ThumbnailCache } from '../services/thumbnailService'
import type { IpcDependencies } from './handlers'

export function registerAnalysisIpcHandlers(deps: IpcDependencies): void {
  const { getWin, trackMediaProcess, isMediaSessionClosed } = deps

  ipcMain.handle('cortexdl:download-comments', async (_event, url: string) => {
    try {
      const win = getWin()
      if (!win) return { success: false, error: 'No main window' }
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Save Comments',
        defaultPath: 'comments.txt',
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
      })
      if (canceled || !filePath) return { success: false, canceled: true }

      win.webContents.send('cortexdl:comments-extraction-started')

      const result = await extractAndSaveComments(url, filePath, (current, total) => {
        win.webContents.send('cortexdl:comments-progress', current, total)
      })
      if (result) {
        return { success: true, filePath }
      }
      return { success: false, error: 'Extraction failed' }
    } catch (e: any) {
      log.error('[main] Error in download-comments:', e)
      return { success: false, error: e.message }
    }
  })

  const analyses = new Map<string, AbortController>()
  const analysisOwners = new Map<number, { controllers: Set<AbortController>; stop: () => void }>()

  ipcMain.handle('cortexdl:cancel-analysis', (event, id: string) => {
    analyses.get(`${event.sender.id}:${id}`)?.abort()
  })

  ipcMain.handle('cortexdl:analyze-url', async (event, input: string, id?: string) => {
    const start = Date.now()
    const url = normalizeAnalysisUrl(input)
    assertAnalysisAllowed(url)
    analysisTiming('normalizationMs', start)
    const controller = new AbortController()
    const key = `${event.sender.id}:${id ?? randomUUID()}`
    analyses.get(key)?.abort()
    analyses.set(key, controller)

    let owner = analysisOwners.get(event.sender.id)
    if (!owner) {
      const controllers = new Set<AbortController>()
      const stop = () => {
        for (const active of controllers) active.abort()
      }
      owner = { controllers, stop }
      analysisOwners.set(event.sender.id, owner)
      event.sender.once('destroyed', stop)
    }
    owner.controllers.add(controller)

    const send = (stage: string, data: unknown) => {
      if (id && !controller.signal.aborted && !event.sender.isDestroyed()) {
        event.sender.send('cortexdl:analysis-update', { id, stage, data })
      }
    }

    const videoId = youtubeVideoId(url)
    analysisTiming('providerDetectionMs', start)
    const enrichment: Promise<unknown>[] = []
    if (id && videoId && !['list', 'list_id'].some(param => new URL(url).searchParams.has(param))) {
      enrichment.push(
        fetchBoundedJson(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
          controller.signal,
        )
          .then(data => {
            if (typeof data.title === 'string') send('preview', { title: data.title })
          })
          .catch(() => {}),
      )
    }

    try {
      if (isThreadsUrl(url)) {
        const result = await analyzeThreadsUrl(url, controller.signal)
        analysisTiming('totalAnalysisMs', start)
        return result
      }
      if (await isDirectMedia(url, controller.signal)) return { kind: 'direct' }
      const hlsResult = await analyzeUrlForHls(url, controller.signal)
      if (hlsResult.kind !== 'unknown' && hlsResult.kind !== 'direct') return hlsResult
      const result = await analyzeWithYtdlp(url, controller.signal)
      analysisTiming('totalAnalysisMs', start)
      if (id && videoId && result.kind === 'ytdlp') {
        const base = process.env.RYD_API_URL || 'https://returnyoutubedislikeapi.com/votes?videoId='
        enrichment.push(
          fetchBoundedJson(`${base}${videoId}`, controller.signal, 2000)
            .then(data => {
              if (typeof data.dislikes === 'number') send('enrichment', { dislikes: data.dislikes })
            })
            .catch(() => {}),
        )
      }
      return result.kind === 'unknown' ? hlsResult : result
    } catch (error) {
      controller.abort()
      throw error
    } finally {
      void Promise.allSettled(enrichment).then(() => {
        owner.controllers.delete(controller)
        if (owner.controllers.size === 0 && analysisOwners.get(event.sender.id) === owner) {
          event.sender.removeListener('destroyed', owner.stop)
          analysisOwners.delete(event.sender.id)
        }
        if (analyses.get(key) === controller) analyses.delete(key)
      })
    }
  })

  ipcMain.on('cortexdl:preview-error', (_event, message: unknown) => {
    if (typeof message === 'string') log.error('[Visual Trim]', message.slice(0, 8000))
  })

  ipcMain.handle(
    'cortexdl:get-trim-preview-streams',
    async (_event, url: string, previewSession: string) => {
      if (typeof previewSession !== 'string' || !/^trim-[\w-]{1,128}$/.test(previewSession)) {
        throw new Error('Invalid trim session')
      }
      if (/\.m3u8(\?|#|$)/i.test(url)) return { videoUrl: url, streamType: 'hls' as const }
      const previewOptions = {
        isClosed: () => isMediaSessionClosed(previewSession),
        track: (stop: () => void) => trackMediaProcess(previewSession, 'probe', stop),
      }
      if (isThreadsUrl(url)) return getThreadsPreviewStreams(url, previewOptions)
      return getTrimPreviewStreams(url, previewOptions)
    },
  )

  ipcMain.handle(
    'cortexdl:get-direct-stream-url',
    async (_event, url: string, previewSession?: string) => {
      try {
        log.info(`[IPC] get-direct-stream-url called for: ${url.slice(0, 80)}...`)
        const previewOptions = previewSession
          ? {
              isClosed: () => isMediaSessionClosed(previewSession),
              track: (stop: () => void) => trackMediaProcess(previewSession, 'probe', stop),
            }
          : {}
        return isThreadsUrl(url)
          ? await getThreadsDirectStreamUrl(url, previewOptions)
          : await getDirectStreamUrl(url, previewOptions)
      } catch (err) {
        log.error('[IPC] get-direct-stream-url error:', err)
        throw err
      }
    },
  )

  const thumbnails = new ThumbnailCache(path.join(os.tmpdir(), 'cortexdl-thumbs'))
  ipcMain.handle('cortexdl:fetch-thumbnail', (_event, url: string) => thumbnails.fetch(url))
}
