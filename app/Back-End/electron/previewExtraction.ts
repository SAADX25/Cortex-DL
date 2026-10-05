import { spawn } from 'node:child_process'
import { killProcessTree } from './utils'

export type PreviewExtractionOptions = {
  isClosed?: () => boolean
  track?: (stop: () => void) => () => void
}

// A single progressive resource: never a playlist or separate video/audio URLs.
export const PREVIEW_FORMAT = 'b[ext=mp4][vcodec^=avc1][protocol=https]/b[ext=webm][vcodec^=vp9][protocol=https]/bv[ext=mp4][vcodec^=avc1][protocol=https]/b[ext=mp4][vcodec^=avc1][protocol=http]'

export function playablePreviewUrl(info: Record<string, unknown>): string {
  if (info.requested_formats || info.requested_downloads && Array.isArray(info.requested_downloads) && info.requested_downloads.length > 1) {
    throw new Error('Unsupported preview: separate video/audio resources')
  }
  const compatible = info.ext === 'mp4' && /^(avc1|h264)/i.test(String(info.vcodec))
    || info.ext === 'webm' && /^(vp9|vp8)/i.test(String(info.vcodec))
  if (!compatible || !['http', 'https'].includes(String(info.protocol))) {
    throw new Error(`Unsupported preview codec/container: ${info.vcodec}/${info.ext}, protocol=${info.protocol}`)
  }
  if (info.acodec && info.acodec !== 'none' && !/^(mp4a|aac|opus|vorbis)/i.test(String(info.acodec))) {
    throw new Error(`Unsupported preview audio codec: ${info.acodec}`)
  }
  const url = new URL(String(info.url))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid preview stream URL')
  const expires = Number(url.searchParams.get('expire') || url.searchParams.get('expires'))
  if (expires > 0 && expires * 1000 <= Date.now()) throw new Error('Expired preview stream URL')
  return url.href
}

export function extractPreview(binary: string, args: string[], options: PreviewExtractionOptions = {}): Promise<string> {
  if (options.isClosed?.()) return Promise.reject(new Error('Preview extraction cancelled'))
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, detached: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
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
      try { resolve(playablePreviewUrl(JSON.parse(stdout))) }
      catch (error) { reject(error) }
    })
  })
}
