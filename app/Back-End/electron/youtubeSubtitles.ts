import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DownloadTask, EngineContext } from './types'
import { runMediaProcess } from './mediaPipeline'
import { probeMediaFile } from './mediaFiles'
import { isYouTubeAuthRequiredError, youtubeErrorCode, YOUTUBE_SUBTITLE_RATE_LIMITED_CODE } from '../../Shared/youtubeErrors'

type SubtitleResult = { exitCode: number; stderr: string }

export async function validateSubtitleFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.size < 10 || stat.size > 10 * 1024 * 1024) return false
    const text = await fs.readFile(file, 'utf8')
    return /^\uFEFF?WEBVTT(?:\s|$)/.test(text)
      && /(?:\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(?:\d{2}:)?\d{2}:\d{2}\.\d{3}[^\n]*\r?\n[^\r\n]+/.test(text)
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
  let result = await run([])
  signal.throwIfAborted()
  const failure = youtubeErrorCode(result.stderr)
  const mayUseAccount = isYouTubeAuthRequiredError(result.stderr) || failure === YOUTUBE_SUBTITLE_RATE_LIMITED_CODE
  if (result.exitCode !== 0 && mayUseAccount && configuredCookies[0] === '--cookies' && configuredCookies[1]) {
    // yt-dlp can rewrite its cookie jar. Keep the user's export unchanged.
    const copy = path.join(task.directory, `.subtitle-cookies-${randomUUID()}.txt`)
    try {
      await fs.copyFile(configuredCookies[1], copy)
      signal.throwIfAborted()
      result = await run(['--cookies', copy])
      signal.throwIfAborted()
    } finally { await fs.rm(copy, { force: true }) }
  }
  if (result.exitCode !== 0) throw new Error(youtubeErrorCode(result.stderr)
    ?? (result.stderr.split(/\r?\n/).find(line => /^ERROR:/i.test(line)) || 'Subtitle download failed'))
  if (!await validateSubtitleFile(file)) throw new Error('YOUTUBE_SUBTITLE_UNAVAILABLE')
  signal.throwIfAborted()
  return file
}

export async function embedYouTubeSubtitle(task: DownloadTask, context: EngineContext, media: string, subtitle: string): Promise<string> {
  context.runtime.abortController?.signal.throwIfAborted()
  if (!await validateSubtitleFile(subtitle)) throw new Error('YOUTUBE_SUBTITLE_UNAVAILABLE')
  const output = path.join(task.directory, `${task.id}.subtitled-${randomUUID()}.mkv`)
  task.phase = 'merging'
  task.status = 'merging'
  context.sendUpdate(task)
  await runMediaProcess(['-i', media, '-i', subtitle, '-map', '0:v?', '-map', '0:a?', '-map', '1:0',
    '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'srt', '-metadata:s:s:0', `language=${task.subtitleLanguage}`,
    '-map_metadata', '0', output], task, context)
  const probe = await probeMediaFile(output, child => { context.runtime.child = child }, context.runtime.abortController?.signal)
  if (!probe.streams?.some(stream => stream.codec_type === 'subtitle')) throw new Error('YOUTUBE_SUBTITLE_UNAVAILABLE')
  return output
}
