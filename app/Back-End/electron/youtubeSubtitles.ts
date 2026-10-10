import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DownloadTask, EngineContext } from './types'
import { runMediaProcess } from './mediaPipeline'
import { probeMediaFile } from './mediaFiles'
import { validateSubtitleMedia } from './mediaFormatRegistry'
import { withCookieSession } from './cookieSession'
import { youtubeDiagnostic } from './youtubeDiagnostics'
import { isYouTubeAuthRequiredError, youtubeErrorCode } from '../../Shared/youtubeErrors'

type SubtitleResult = { exitCode: number; stderr: string }

export async function validateSubtitleFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.size < 10 || stat.size > 10 * 1024 * 1024) return false
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(file))
    if (/<(?:!doctype|html|body|head)\b/i.test(text) || !/^\uFEFF?WEBVTT(?:\s|$)/.test(text)) return false
    const time = (value: string) => {
      const parts = value.split(':').map(Number)
      if (parts.slice(-2).some(n => n >= 60)) return NaN
      return parts.reduce((total, n) => total * 60 + n, 0)
    }
    let cues = 0
    for (const block of text.split(/\r?\n\s*\r?\n/).slice(1)) {
      if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue
      const match = /^((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})[^\r\n]*\r?\n([\s\S]*)/m.exec(block)
      if (!match) { if (block.includes('-->')) return false; continue }
      if (!(time(match[2]) > time(match[1]))) return false
      if (match[3].replace(/<[^>]+>/g, '').trim()) cues++
    }
    return cues > 0
  } catch { return false }
}

/** Fetch captions separately so their account session cannot limit the video formats. */
export async function prepareYouTubeSubtitle(
  task: DownloadTask,
  configuredCookies: string[],
  signal: AbortSignal,
  run: (cookies: string[]) => Promise<SubtitleResult>,
): Promise<string> {
  signal.throwIfAborted()
  if (!task.subtitleLanguage || !/^[a-zA-Z0-9_-]+$/.test(task.subtitleLanguage)) throw new Error('Invalid subtitle language')
  const file = path.join(task.directory, `${task.id}.${task.subtitleLanguage}.vtt`)
  if (await validateSubtitleFile(file)) { signal.throwIfAborted(); return file }
  try {
    let result = await run([])
    signal.throwIfAborted()
    const mayUseAccount = isYouTubeAuthRequiredError(result.stderr)
    if (result.exitCode !== 0 && mayUseAccount && configuredCookies[0] === '--cookies' && configuredCookies[1]) {
      // yt-dlp can rewrite its cookie jar. Keep the user's export unchanged.
      await fs.rm(file, { force: true })
      result = await withCookieSession(configuredCookies, signal, run)
      signal.throwIfAborted()
    }
    if (result.exitCode !== 0) throw new Error(youtubeErrorCode(result.stderr)
      ?? (result.stderr.split(/\r?\n/).find(line => /^ERROR:/i.test(line)) || 'Subtitle download failed'))
    if (!await validateSubtitleFile(file)) throw new Error('YOUTUBE_SUBTITLE_UNAVAILABLE')
    signal.throwIfAborted()
    return file
  } catch (error) {
    await Promise.all([fs.rm(file, { force: true }), fs.rm(file + '.part', { force: true })])
    throw error
  }
}

export async function embedYouTubeSubtitle(task: DownloadTask, context: EngineContext, media: string, subtitle: string): Promise<string> {
  context.runtime.abortController?.signal.throwIfAborted()
  if (!await validateSubtitleFile(subtitle)) throw new Error('YOUTUBE_SUBTITLE_UNAVAILABLE')
  const output = path.join(task.directory, `${task.id}.subtitled-${randomUUID()}.mkv`)
  const source = await probeMediaFile(media, child => { context.runtime.child = child }, context.runtime.abortController?.signal)
  task.phase = 'merging'
  task.status = 'merging'
  context.sendUpdate(task)
  try {
    await runMediaProcess(['-i', media, '-i', subtitle, '-map', '0:v?', '-map', '0:a?', '-map', '1:0',
      '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'srt', '-metadata:s:s:0', `language=${task.subtitleLanguage}`,
      '-map_metadata', '0', output], task, context)
    const probe = await probeMediaFile(output, child => { context.runtime.child = child }, context.runtime.abortController?.signal)
    validateSubtitleMedia(source, probe, task.subtitleLanguage)
    youtubeDiagnostic('subtitle-merge', { decision: 'stream-copy', video: probe.streams?.filter(s => s.codec_type === 'video'), subtitlePresent: true })
    return output
  } catch (error) { await fs.rm(output, { force: true }); throw error }
}
