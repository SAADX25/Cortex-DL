import { engineExecutionFailed } from './engineReadiness'
import { spawn } from 'node:child_process'
import { killProcessTree } from './utils'

export type PreviewExtractionOptions = {
  isClosed?: () => boolean
  track?: (stop: () => void) => () => void
}

// Progressive, muxed formats supported by Chromium. Include the newer vp09/vp08
// codec labels and both HTTP schemes; never select separate or video-only streams.
const PREVIEW_CODECS = [
  'b[ext=mp4][vcodec^=avc1][acodec!=none]',
  'b[ext=mp4][vcodec^=avc3][acodec!=none]',
  'b[ext=mp4][vcodec^=h264][acodec!=none]',
  'b[ext=webm][vcodec^=vp09][acodec!=none]',
  'b[ext=webm][vcodec^=vp9][acodec!=none]',
  'b[ext=webm][vcodec^=vp08][acodec!=none]',
  'b[ext=webm][vcodec^=vp8][acodec!=none]',
]
export const PREVIEW_FORMAT = ['https', 'http']
  .flatMap(protocol => PREVIEW_CODECS.map(format => `${format}[protocol=${protocol}]`))
  .join('/')

export type PreviewStreams = { videoUrl: string; audioUrl?: string }
// Modern YouTube commonly exposes only separate progressive video/audio resources.
export const TRIM_PREVIEW_FORMAT = `${PREVIEW_FORMAT}/bv[ext=mp4][vcodec^=avc1][protocol=https][height<=1080]+ba[acodec^=mp4a][protocol=https]/bv[ext=webm][vcodec^=vp9][protocol=https][height<=1080]+ba[acodec=opus][protocol=https]`

function progressiveUrl(info: Record<string, unknown>): string {
  if (!['http', 'https'].includes(String(info.protocol))) throw new Error('Preview requires a progressive HTTP stream')
  const url = new URL(String(info.url))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid preview stream URL')
  const expires = Number(url.searchParams.get('expire') || url.searchParams.get('expires'))
  if (expires > 0 && expires * 1000 <= Date.now()) throw new Error('Expired preview stream URL')
  return url.href
}

export function playablePreviewStreams(info: Record<string, unknown>): PreviewStreams {
  if (!Array.isArray(info.requested_formats)) return { videoUrl: playablePreviewUrl(info) }
  const formats = info.requested_formats as Record<string, unknown>[]
  const video = formats.find(format => format.vcodec && format.vcodec !== 'none')
  const audio = formats.find(format => format.vcodec === 'none' && format.acodec && format.acodec !== 'none')
  if (formats.length !== 2 || !video || !audio) throw new Error('Preview requires exactly one video and one audio resource')
  // Reuse the browser codec checks, with the audio codec supplied by its own resource.
  const videoUrl = playablePreviewUrl({ ...video, acodec: audio.acodec })
  return { videoUrl, audioUrl: progressiveUrl(audio) }
}

export function playablePreviewUrl(info: Record<string, unknown>): string {
  if (info.requested_formats || info.requested_downloads && Array.isArray(info.requested_downloads) && info.requested_downloads.length > 1) {
    throw new Error('Unsupported preview: separate video/audio resources')
  }
  const compatible = info.ext === 'mp4' && /^(avc1|avc3|h264)/i.test(String(info.vcodec))
    || info.ext === 'webm' && /^(vp09|vp9|vp08|vp8)/i.test(String(info.vcodec))
  if (!compatible || !['http', 'https'].includes(String(info.protocol))) {
    throw new Error(`Unsupported preview codec/container: ${info.vcodec}/${info.ext}, protocol=${info.protocol}`)
  }
  if (!info.acodec || info.acodec === 'none') {
    throw new Error('Unsupported preview: selected video stream has no audio track')
  }
  if (!/^(mp4a|aac|opus|vorbis)/i.test(String(info.acodec))) {
    throw new Error(`Unsupported preview audio codec: ${info.acodec}`)
  }
  const url = new URL(String(info.url))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid preview stream URL')
  const expires = Number(url.searchParams.get('expire') || url.searchParams.get('expires'))
  if (expires > 0 && expires * 1000 <= Date.now()) throw new Error('Expired preview stream URL')
  return url.href
}

export function extractPreview(binary: string, args: string[], options: PreviewExtractionOptions = {}): Promise<string> {
  return runPreviewExtraction(binary, args, playablePreviewUrl, options)
}

export function extractPreviewStreams(binary: string, args: string[], options: PreviewExtractionOptions = {}): Promise<PreviewStreams> {
  return runPreviewExtraction(binary, args, playablePreviewStreams, options)
}

function runPreviewExtraction<T>(binary: string, args: string[], parse: (info: Record<string, unknown>) => T, options: PreviewExtractionOptions): Promise<T> {
  if (options.isClosed?.()) return Promise.reject(new Error('Preview extraction cancelled'))
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, detached: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    child.on('error', error => engineExecutionFailed('yt-dlp', error))
    let stdout = '', stderr = '', failure = ''
    let untrack = () => {}
    let teardown: Promise<void> | undefined
    const stop = (reason: string) => {
      failure ||= reason
      teardown ??= killProcessTree(child)
    }
    const timer = setTimeout(() => stop('yt-dlp preview extraction timed out after 30 seconds'), 30_000)
    untrack = options.track?.(() => stop('Preview extraction cancelled')) ?? untrack
    child.stdout.on('data', data => { stdout += data.toString() })
    child.stderr.on('data', data => { stderr += data.toString() })
    child.once('error', error => { failure ||= `Failed to spawn yt-dlp: ${error.message}` })
    child.once('close', async code => {
      clearTimeout(timer)
      await teardown
      untrack()
      if (failure || code !== 0) { reject(new Error(failure || stderr.trim() || `yt-dlp exited with code ${code}`)); return }
      try { resolve(parse(JSON.parse(stdout))) }
      catch (error) { reject(error) }
    })
  })
}
