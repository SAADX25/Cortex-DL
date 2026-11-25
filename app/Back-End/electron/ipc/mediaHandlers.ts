// IPC handlers for local media endpoint info, FPS probing, subtitle track discovery, and media diagnostics
import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, promises as fsPromises } from 'node:fs'
import path from 'node:path'
import type { PlayerSubtitleTrack } from '../../../Shared/types'
import { engineExecutionFailed, ensureEnginesReady } from '../engines/engineManager'
import { getBinaryPath } from '../paths'
import type { IpcDependencies } from './handlers'

const SUBTITLE_SOURCE_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.avi',
  '.mov',
  '.ogv',
  '.m4v',
  '.mp3',
  '.m4a',
  '.aac',
  '.opus',
  '.flac',
  '.wav',
  '.ogg',
  '.wma',
])

export function registerMediaIpcHandlers(deps: IpcDependencies): void {
  const {
    getMediaPort,
    getMediaToken,
    closeMediaSession,
    getMediaRequestStats,
    trackMediaProcess,
    isMediaSessionClosed,
  } = deps

  ipcMain.handle(
    'cortexdl:get-media-fps',
    async (_event, filePath: string, playerSession: string) => {
      if (isMediaSessionClosed(playerSession)) return null
      let untrack = () => {}
      try {
        const { MediaProcessor } = await import('../engines/MediaProcessor')
        if (isMediaSessionClosed(playerSession)) return null
        const processor = new MediaProcessor()
        untrack = trackMediaProcess(playerSession, 'probe', () => processor.killAll())
        if (isMediaSessionClosed(playerSession)) return null
        return await processor.getFps(filePath)
      } catch (err) {
        log.error('Failed to get media FPS:', err)
        return null
      } finally {
        untrack()
      }
    },
  )

  ipcMain.handle('cortexdl:get-media-port', async () => {
    await deps.mediaReadyPromise
    return getMediaPort()
  })

  ipcMain.handle('cortexdl:get-media-endpoint', async () => {
    await deps.mediaReadyPromise
    return { port: getMediaPort(), token: getMediaToken() }
  })

  ipcMain.handle('cortexdl:close-media-session', (_event, session: string) => {
    return closeMediaSession(session)
  })

  ipcMain.handle('cortexdl:get-media-diagnostics', async () => {
    if (app.isPackaged && process.env.CORTEX_DL_MEDIA_DIAGNOSTICS !== '1') return null
    return {
      processMetrics: app.getAppMetrics().map(metric => ({
        pid: metric.pid,
        type: metric.type,
        memory: metric.memory,
      })),
      mainMemory: await process.getProcessMemoryInfo(),
      requests: getMediaRequestStats(),
    }
  })

  ipcMain.handle(
    'cortexdl:get-subtitles',
    async (_event, videoPath: string, playerSession: string) => {
      try {
        if (isMediaSessionClosed(playerSession)) return []
        const normalizedVideoPath = videoPath ? path.normalize(videoPath) : ''
        if (!normalizedVideoPath || !existsSync(normalizedVideoPath)) return []
        const stat = lstatSync(normalizedVideoPath)
        if (stat.isSymbolicLink() || !stat.isFile()) return []

        const ext = path.extname(normalizedVideoPath)
        if (!SUBTITLE_SOURCE_EXTENSIONS.has(ext.toLowerCase())) return []
        const dir = path.dirname(normalizedVideoPath)
        const baseName = path.basename(normalizedVideoPath, ext)
        const files = await fsPromises.readdir(dir)
        const subtitles: PlayerSubtitleTrack[] = []

        for (const file of files) {
          if (file.startsWith(baseName + '.') && (file.endsWith('.vtt') || file.endsWith('.srt'))) {
            const namePart = file.slice(baseName.length, -path.extname(file).length)
            const langCode = namePart.replace(/^\./, '') || 'Unknown'
            subtitles.push({
              label: langCode.toUpperCase(),
              language: langCode,
              filePath: path.join(dir, file),
              isEmbedded: false,
            })
          }
        }

        try {
          await ensureEnginesReady(['ffprobe'])
          const ffprobePath = getBinaryPath('ffprobe')
          if (
            existsSync(ffprobePath) &&
            ['.mp4', '.mkv', '.webm', '.mov', '.m4v'].includes(ext.toLowerCase())
          ) {
            if (isMediaSessionClosed(playerSession)) return []
            const probeData = await new Promise<string>((resolve, reject) => {
              let output = ''
              const p = spawn(
                ffprobePath,
                [
                  '-v',
                  'error',
                  '-show_entries',
                  'stream=index,codec_name:stream_tags=language,title,handler_name',
                  '-select_streams',
                  's',
                  '-of',
                  'json',
                  videoPath,
                ],
                { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
              )
              const untrack = trackMediaProcess(playerSession, 'probe', () => p.kill())
              const timer = setTimeout(() => p.kill(), 15_000)
              timer.unref()

              p.stdout.on('data', d => {
                output += d.toString()
                if (output.length > 1024 * 1024) p.kill()
              })
              p.on('close', code => {
                clearTimeout(timer)
                untrack()
                if (code === 0) resolve(output)
                else reject(new Error('ffprobe failed'))
              })
              p.on('error', error => engineExecutionFailed('ffprobe', error))
              p.on('error', err => {
                clearTimeout(timer)
                untrack()
                reject(err)
              })
            })

            const parsed = JSON.parse(probeData)
            if (parsed && Array.isArray(parsed.streams)) {
              for (const stream of parsed.streams) {
                const langCode = stream.tags?.title || stream.tags?.language || 'Unknown'
                const label =
                  stream.tags?.title ||
                  (stream.tags?.handler_name !== 'SubtitleHandler'
                    ? stream.tags?.handler_name
                    : undefined) ||
                  langCode.toUpperCase()
                subtitles.push({
                  label: `[Embedded] ${label}`,
                  language: langCode,
                  isEmbedded: true,
                  streamIndex: stream.index,
                })
              }
            }
          }
        } catch (err) {
          if (!isMediaSessionClosed(playerSession)) {
            log.error('[handlers] Failed to probe embedded subtitles:', err)
          }
        }

        return subtitles
      } catch (err) {
        log.error('Failed to get subtitles:', err)
        return []
      }
    },
  )
}
