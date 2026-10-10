import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DownloadSubtitleFile, SubtitleMergeFormat } from '../../../Shared/downloadSubtitles'
import { SUBTITLE_LANGUAGES } from '../../../Shared/localSubtitles'
import { ensureEnginesReady } from '../engineReadiness'
import { getBinaryPath } from '../paths'
import { probeMediaFile } from '../mediaFiles'
import { subtitleLanguageTag, validateSubtitleMedia } from '../mediaFormatRegistry'
import { SubtitleProcesses } from './process'

const directoryReads = new Map<string, Promise<string[]>>()
async function readDirectory(directory: string): Promise<string[]> {
  const existing = directoryReads.get(directory)
  if (existing) return existing
  const reading = fs.readdir(directory).catch(() => [])
  directoryReads.set(directory, reading)
  try { return await reading } finally { directoryReads.delete(directory) }
}

/** Only matching, nonempty timed sidecars next to this video are offered. */
export async function listDownloadSubtitles(media: string): Promise<DownloadSubtitleFile[]> {
  const directory = path.dirname(media), base = path.parse(media).name
  const files = await readDirectory(directory)
  const matches = await Promise.all(files.filter(file => {
    const name = path.parse(file)
    return /\.(srt|vtt)$/i.test(name.ext) && (name.name.toLowerCase() === base.toLowerCase() || name.name.toLowerCase().startsWith(base.toLowerCase() + '.'))
  }).map(async (fileName): Promise<DownloadSubtitleFile | null> => {
    const file = path.join(directory, fileName), stat = await fs.lstat(file).catch(() => null)
    if (!stat?.isFile() || stat.size <= 0 || stat.size > 5 * 1024 * 1024) return null
    const text = await fs.readFile(file, 'utf8').catch(() => '')
    if (!/(?:\d{2}:)?\d{2}:\d{2}[,.]\d{3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}[,.]\d{3}/.test(text)) return null
    const suffix = path.parse(fileName).name.slice(base.length).replace(/^\./, '')
    const language = /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(suffix) ? suffix.toLowerCase() : 'und'
    const label = SUBTITLE_LANGUAGES[language as keyof typeof SUBTITLE_LANGUAGES] ?? (language === 'und' ? fileName : language.toUpperCase())
    return { fileName, language, label }
  }))
  return matches.filter((file): file is DownloadSubtitleFile => file !== null).sort((a, b) => a.fileName.localeCompare(b.fileName))
}

/** Saves a separate, switchable subtitle track; audio/video packets are copied. */
export async function mergeDownloadSubtitle(media: string, fileName: string, output: string, format: SubtitleMergeFormat, signal: AbortSignal): Promise<void> {
  if (!['mp4', 'mkv'].includes(format) || path.extname(output).toLowerCase() !== `.${format}`) throw new Error('INVALID_SUBTITLE_OUTPUT')
  const track = (await listDownloadSubtitles(media)).find(file => file.fileName === fileName)
  if (!track) throw new Error('SUBTITLE_FILE_UNAVAILABLE')
  const caption = path.join(path.dirname(media), track.fileName)
  const resolved = async (file: string) => (await fs.realpath(file).catch(() => path.resolve(file))).toLowerCase()
  const target = await resolved(output)
  if (target === await resolved(media) || target === await resolved(caption)) throw new Error('CHOOSE_NEW_SUBTITLE_OUTPUT')
  const temporary = path.join(path.dirname(output), `.cortex-merge-${randomUUID()}.${format}`)
  const processes = new SubtitleProcesses(signal)
  try {
    signal.throwIfAborted()
    await ensureEnginesReady(['ffmpeg', 'ffprobe']); signal.throwIfAborted()
    const before = await probeMediaFile(media, undefined, signal)
    if (!before.streams?.some(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)) throw new Error('SELECT_VIDEO_FOR_SUBTITLES')
    const subtitleIndex = before.streams?.filter(stream => stream.codec_type === 'subtitle').length ?? 0
    await processes.run(getBinaryPath('ffmpeg'), ['-n', '-nostdin', '-v', 'error', '-i', media, '-sub_charenc', 'UTF-8', '-i', caption,
      '-map', '0:v?', '-map', '0:a?', '-map', '0:s?', '-map', '1:s:0', '-c:v', 'copy', '-c:a', 'copy', '-c:s', format === 'mp4' ? 'mov_text' : 'copy',
      `-c:s:${subtitleIndex}`, format === 'mp4' ? 'mov_text' : 'srt',
      `-metadata:s:s:${subtitleIndex}`, `language=${subtitleLanguageTag(track.language)}`, `-metadata:s:s:${subtitleIndex}`, `title=${track.label}`,
      '-disposition:s', '0', `-disposition:s:${subtitleIndex}`, 'default', '-map_metadata', '0', ...(format === 'mp4' ? ['-movflags', '+faststart'] : []), temporary])
    const after = await probeMediaFile(temporary, undefined, signal)
    validateSubtitleMedia(before, after, track.language)
    for (const kind of ['video', 'audio']) {
      const source = before.streams?.filter(stream => stream.codec_type === kind), saved = after.streams?.filter(stream => stream.codec_type === kind)
      if (source?.length !== saved?.length || source?.some((stream, index) => stream.codec_name !== saved?.[index]?.codec_name)) throw new Error('Subtitle processing changed media codecs')
    }
    signal.throwIfAborted()
    await fs.rename(temporary, output)
  } finally { await processes.stop(); await fs.rm(temporary, { force: true }) }
}
