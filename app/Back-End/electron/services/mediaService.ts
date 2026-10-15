import { type AudioFormat, type TargetFormat, type VideoFormat, AUDIO_FORMATS, type DownloadTask, VIDEO_FORMATS, type EngineContext } from '../types'
import { ensureEnginesReady, engineExecutionFailed } from '../engines/engineManager'
import { promises as fs } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { getBinaryPath } from '../paths'
import { killProcessTree } from '../utils'
import { flushLines } from '../progressParser'
import { availableParallelism } from 'node:os'

type AudioSpec = {
  ytDlpFormat: string
  codec: string
  containers: readonly string[]
  ffmpegArgs: readonly string[]
}

export const AUDIO_SPECS: Record<AudioFormat, AudioSpec> = {
  mp3: { ytDlpFormat: 'mp3', codec: 'mp3', containers: ['mp3'], ffmpegArgs: ['-c:a', 'libmp3lame', '-q:a', '0'] },
  wav: { ytDlpFormat: 'wav', codec: 'pcm_s16le', containers: ['wav'], ffmpegArgs: ['-c:a', 'pcm_s16le'] },
  m4a: { ytDlpFormat: 'm4a', codec: 'aac', containers: ['mov', 'mp4', 'm4a'], ffmpegArgs: ['-c:a', 'aac', '-b:a', '256k', '-f', 'ipod'] },
  ogg: { ytDlpFormat: 'vorbis', codec: 'vorbis', containers: ['ogg'], ffmpegArgs: ['-c:a', 'libvorbis', '-q:a', '6', '-f', 'ogg'] },
  flac: { ytDlpFormat: 'flac', codec: 'flac', containers: ['flac'], ffmpegArgs: ['-c:a', 'flac'] },
  aac: { ytDlpFormat: 'aac', codec: 'aac', containers: ['aac'], ffmpegArgs: ['-c:a', 'aac', '-b:a', '256k', '-f', 'adts'] },
  opus: { ytDlpFormat: 'opus', codec: 'opus', containers: ['ogg'], ffmpegArgs: ['-c:a', 'libopus', '-b:a', '192k', '-f', 'opus'] },
  wma: { ytDlpFormat: 'wav', codec: 'wmav2', containers: ['asf'], ffmpegArgs: ['-c:a', 'wmav2', '-b:a', '192k', '-f', 'asf'] },
}

export type MediaProbe = {
  format?: { format_name?: string; duration?: string }
  streams?: { codec_type?: string; codec_name?: string; duration?: string; width?: number; height?: number;
    avg_frame_rate?: string; r_frame_rate?: string; tags?: { language?: string; title?: string; handler_name?: string }; disposition?: { attached_pic?: number } }[]
}

export function subtitleLanguageTag(language: string): string {
  const codes: Record<string, string> = { en: 'eng', ar: 'ara', fr: 'fra', de: 'deu', es: 'spa', it: 'ita', pt: 'por',
    ru: 'rus', ja: 'jpn', ko: 'kor', zh: 'zho', hi: 'hin', tr: 'tur', nl: 'nld', pl: 'pol', uk: 'ukr',
    fa: 'fas', he: 'heb', id: 'ind', vi: 'vie', th: 'tha', sv: 'swe', da: 'dan', no: 'nor', fi: 'fin',
    cs: 'ces', el: 'ell', ro: 'ron', hu: 'hun', bn: 'ben', ur: 'urd', ta: 'tam', te: 'tel', ms: 'msa' }
  const base = language.split('-')[0]
  return codes[base] ?? (/^[a-z]{3}$/.test(base) ? base : 'und')
}

export function validateSubtitleMedia(source: MediaProbe, output: MediaProbe, language?: string): void {
  const before = source.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const after = output.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic)
  if (before && (!after || before.width !== after.width || before.height !== after.height)) throw new Error('Subtitle processing changed video resolution')
  const rate = (value?: string) => { const [n, d = '1'] = (value ?? '0').split('/'); return Number(n) / Number(d) }
  if (before && rate(before.avg_frame_rate) > 0 && Math.abs(rate(before.avg_frame_rate) - rate(after?.avg_frame_rate)) > 0.01) throw new Error('Subtitle processing changed video FPS')
  if (source.streams?.some(s => s.codec_type === 'audio') && !output.streams?.some(s => s.codec_type === 'audio')) throw new Error('Subtitle processing removed audio')
  if (!output.streams?.some(s => s.codec_type === 'subtitle' && (!language || s.tags?.language === language
    || s.tags?.title === language || s.tags?.handler_name === language || (subtitleLanguageTag(language) !== 'und' && s.tags?.language === subtitleLanguageTag(language))))) throw new Error('SUBTITLE_TRACK_UNAVAILABLE')
}

type VideoSpec = { containers: string[]; video: string[]; audio?: string[]; args: string[] }

const VIDEO_SPECS: Record<VideoFormat, VideoSpec> = {
  mp4: { containers: ['mov', 'mp4'], video: ['h264', 'hevc', 'mpeg4', 'av1', 'vp9'], audio: ['aac', 'mp3', 'alac'], args: ['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', '-f', 'mp4'] },
  m4v: { containers: ['mov', 'mp4'], video: ['h264', 'hevc', 'mpeg4'], audio: ['aac', 'alac'], args: ['-c:v', 'libx264', '-c:a', 'aac', '-f', 'mp4'] },
  mov: { containers: ['mov'], video: ['h264', 'hevc', 'mpeg4', 'prores', 'mjpeg'], audio: ['aac', 'alac', 'pcm_s16le'], args: ['-c:v', 'libx264', '-c:a', 'aac', '-f', 'mov'] },
  mkv: { containers: ['matroska'], video: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'theora', 'mjpeg', 'prores'], args: ['-c:v', 'libx264', '-c:a', 'aac', '-f', 'matroska'] },
  webm: { containers: ['webm'], video: ['vp8', 'vp9', 'av1'], audio: ['opus', 'vorbis'], args: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '5', '-c:a', 'libopus', '-f', 'webm'] },
  avi: { containers: ['avi'], video: ['mpeg4', 'h264', 'mjpeg'], audio: ['mp3', 'pcm_s16le'], args: ['-c:v', 'mpeg4', '-c:a', 'libmp3lame', '-f', 'avi'] },
  ogv: { containers: ['ogg'], video: ['theora'], audio: ['vorbis'], args: ['-c:v', 'libtheora', '-c:a', 'libvorbis', '-f', 'ogg'] },
  gif: { containers: ['gif'], video: ['gif'], args: ['-an', '-vf', 'fps=15,scale=480:-1:flags=lanczos', '-f', 'gif'] },
}

export const MediaFormatRegistry = Object.fromEntries([
  ...Object.entries(AUDIO_SPECS).map(([extension, spec]) => [extension, { extension, container: spec.containers, videoCodec: null, audioCodec: [spec.codec], ffmpegArgs: ['-vn', ...spec.ffmpegArgs] }]),
  ...Object.entries(VIDEO_SPECS).map(([extension, spec]) => [extension, { extension, container: spec.containers, videoCodec: spec.video, audioCodec: spec.audio, ffmpegArgs: spec.args }]),
]) as Record<TargetFormat, { extension: string; container: readonly string[]; videoCodec: string[] | null; audioCodec?: readonly string[]; ffmpegArgs: readonly string[] }>

export function matchesMediaFormat(format: TargetFormat, probe: MediaProbe): boolean {
  const spec = MediaFormatRegistry[format]
  const containers = (probe.format?.format_name ?? '').split(',')
  if (!spec.container.some(c => containers.includes(c))) return false
  const streams = probe.streams ?? []
  const video = streams.filter(s => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.filter(s => s.codec_type === 'audio')
  if (spec.videoCodec === null) return video.length === 0 && audio.length > 0 && audio.every(s => spec.audioCodec?.includes(s.codec_name ?? ''))
  return video.length > 0 && video.every(s => spec.videoCodec!.includes(s.codec_name ?? '')) &&
    (!spec.audioCodec || audio.every(s => spec.audioCodec!.includes(s.codec_name ?? '')))
}

export type MediaConversion = 'direct' | 'remux' | 'audio-encode' | 'video-encode' | 'full-transcode'

export function decideMediaConversion(format: TargetFormat, source?: MediaProbe, trim = false): MediaConversion {
  const spec = MediaFormatRegistry[format]
  if (!source || trim || format === 'gif') return spec.videoCodec ? 'full-transcode' : 'audio-encode'
  if (matchesMediaFormat(format, source)) return 'direct'
  const video = source.streams?.filter(s => s.codec_type === 'video' && !s.disposition?.attached_pic) ?? []
  const audio = source.streams?.filter(s => s.codec_type === 'audio') ?? []
  const audioCompatible = spec.audioCodec ? audio.length > 0 && audio.every(s => spec.audioCodec!.includes(s.codec_name ?? '')) : true
  if (!spec.videoCodec) return audioCompatible ? 'remux' : 'audio-encode'
  const videoCompatible = video.length > 0 && video.every(s => spec.videoCodec!.includes(s.codec_name ?? ''))

  const copyAudio = audio.length === 0 || audioCompatible
  if (videoCompatible && copyAudio) return 'remux'
  if (videoCompatible) return 'audio-encode'
  if (copyAudio) return 'video-encode'
  return 'full-transcode'
}

export function mediaOutputArgs(format: TargetFormat, output: string, source?: MediaProbe, trim = false): string[] {
  const spec = MediaFormatRegistry[format]
  const decision = decideMediaConversion(format, source, trim)
  const mapping: string[] = []
  const subtitleArgs: string[] = []
  if (spec.videoCodec && format !== 'gif') {
    mapping.push('-map', '0:v:0', '-map', '0:a?')
    if (source?.streams?.some(s => s.codec_type === 'subtitle') && ['mp4', 'mov', 'm4v', 'mkv', 'webm'].includes(format)) {
      mapping.push('-map', '0:s?')
      subtitleArgs.push('-c:s', format === 'mkv' ? 'copy' : format === 'webm' ? 'webvtt' : 'mov_text')
      source.streams.filter(s => s.codec_type === 'subtitle').forEach((stream, index) => {
        const language = stream.tags?.title || stream.tags?.language
        if (language) subtitleArgs.push(`-metadata:s:s:${index}`, `language=${['mp4', 'mov', 'm4v'].includes(format) ? subtitleLanguageTag(language) : language}`,
          `-metadata:s:s:${index}`, `title=${language}`, `-metadata:s:s:${index}`, `handler_name=${language}`)
      })
    }
  }
  if (decision === 'direct' || decision === 'remux') {
    const muxer = format === 'm4v' ? 'mp4' : format === 'm4a' ? 'ipod' : format === 'mkv' ? 'matroska' : format === 'aac' ? 'adts' : format === 'wma' ? 'asf' : format === 'ogv' ? 'ogg' : format
    return [...mapping, ...(spec.videoCodec === null ? ['-vn'] : []), '-c', 'copy', ...subtitleArgs, '-map_metadata', '0', '-f', muxer, output]
  }

  const encoding = [...spec.ffmpegArgs]
  if (encoding.includes('libx264')) encoding.push('-preset', 'veryfast')
  if (!trim && spec.videoCodec && format !== 'gif') {
    const flag = decision === 'audio-encode' ? '-c:v' : decision === 'video-encode' ? '-c:a' : null
    if (flag) {
      const index = encoding.indexOf(flag)
      if (index >= 0) encoding[index + 1] = 'copy'
    }
  }
  return [...mapping, ...encoding, ...subtitleArgs, '-map_metadata', '0', output]
}

export function isAudioFormat(format: TargetFormat): format is AudioFormat {
  return AUDIO_FORMATS.includes(format as AudioFormat)
}

const supported = new Set<string>([...AUDIO_FORMATS, ...VIDEO_FORMATS])

export function isSupportedMediaPath(filePath: string): boolean {
  return supported.has(path.extname(filePath).slice(1).toLowerCase())
}

export async function findTaskMediaFile(task: DownloadTask, detected: string | null): Promise<string | null> {
  if (detected && path.dirname(detected) === task.directory &&
      path.basename(detected).startsWith(`${task.id}.`) && isSupportedMediaPath(detected) &&
      await fs.stat(detected).then(s => s.isFile() && s.size > 0).catch(() => false)) return detected
  const files = await fs.readdir(task.directory).catch(() => [])
  for (const name of files) {
    if (!name.startsWith(`${task.id}.`) || !isSupportedMediaPath(name)) continue
    const filePath = path.join(task.directory, name)
    if (await fs.stat(filePath).then(s => s.isFile() && s.size > 0).catch(() => false)) return filePath
  }
  return null
}

export async function probeMediaFile(
  filePath: string,
  track?: (child: ChildProcessWithoutNullStreams | null) => void,
  signal?: AbortSignal,
): Promise<MediaProbe> {
  signal?.throwIfAborted()
  await ensureEnginesReady(['ffprobe'])
  signal?.throwIfAborted()
  const stat = await fs.stat(filePath)
  signal?.throwIfAborted()
  if (!stat.isFile() || stat.size <= 0) throw new Error('Media output is empty')
  const child = spawn(getBinaryPath('ffprobe'), [
    '-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,duration,width,height,avg_frame_rate,r_frame_rate:stream_tags=language,title,handler_name:stream_disposition=attached_pic',
    '-of', 'json', filePath,
  ], { windowsHide: true, detached: false })
  child.on('error', error => engineExecutionFailed('ffprobe', error))
  track?.(child)
  const onAbort = () => { child.kill() }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
    if (output.length > 1024 * 1024) child.kill()
  })
  child.stderr.resume()
  const timeout = setTimeout(() => child.kill(), 15_000)
  try {
    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', code => resolve(code ?? 1))
      child.on('error', () => resolve(1))
    })
    signal?.throwIfAborted()
    if (exitCode !== 0 || !output || output.length > 1024 * 1024) {
      throw new Error('ffprobe could not validate the media output')
    }
    return JSON.parse(output) as MediaProbe
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
    child.stdout.removeAllListeners()
    child.stderr.removeAllListeners()
    track?.(null)
  }
}

export function trimBounds(task: Pick<DownloadTask, 'startTime' | 'endTime'>): { start: number; end?: number } {
  const parse = (value: string) => {
    if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(value.trim())) throw new Error('Invalid trim time')
    const pieces = value.trim().split(':').map(Number)
    if (pieces.slice(1).some(n => n >= 60)) throw new Error('Invalid trim time')
    const seconds = pieces.reduce((sum, n) => sum * 60 + n, 0)
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid trim time')
    return seconds
  }
  const start = task.startTime ? parse(task.startTime) : 0
  const end = task.endTime ? parse(task.endTime) : undefined
  if (end !== undefined && end <= start) throw new Error('End time must be greater than start time')
  return { start, end }
}

export async function runMediaProcess(args: string[], task: DownloadTask, ctx: EngineContext, duration?: number): Promise<void> {
  await ensureEnginesReady(['ffmpeg', 'ffprobe'])
  const signal = ctx.runtime.abortController?.signal
  signal?.throwIfAborted()

  const budget = Math.max(2, Math.min(4, Math.floor(availableParallelism() / 2)))
  const decoderThreads = String(Math.max(1, Math.floor(budget / 3)))
  const encoderThreads = String(Math.max(1, budget - Number(decoderThreads)))
  const proc = spawn(getBinaryPath('ffmpeg'), ['-y', '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', decoderThreads, '-filter_threads', '1', '-filter_complex_threads', '1', '-progress', 'pipe:1', ...args.slice(0, -1), '-threads', encoderThreads, args[args.length - 1]], { windowsHide: true, detached: process.platform !== 'win32' })
  proc.on('error', error => engineExecutionFailed('ffmpeg', error))
  ctx.runtime.child = proc
  let teardown: Promise<void> | undefined
  const terminate = () => { teardown ??= killProcessTree(proc) }
  let errors = ''
  let lastActivity = Date.now()
  let stalled = false
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity < 90000) return
    stalled = true
    terminate()
  }, 5000)
  watchdog.unref?.()
  let remainder = ''
  const onAbort = terminate
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  proc.stdout.on('data', (chunk: Buffer) => {
    if (signal?.aborted) return
    lastActivity = Date.now()
    const [lines, rest] = flushLines(remainder, chunk.toString())
    remainder = rest
    for (const line of lines) {
      const match = /^out_time_us=(\d+)$/.exec(line)
      if (match && duration && duration > 0) {
        task.convertingPercent = Math.min(100, Number(match[1]) / 1e6 / duration * 100)
        ctx.sendUpdate(task)
      }
    }
  })
  proc.stderr.on('data', (chunk: Buffer) => { lastActivity = Date.now(); errors = (errors + chunk.toString()).slice(-8192) })
  try {
    const code = await new Promise<number>(resolve => {
      proc.on('error', () => resolve(1))
      proc.on('close', value => resolve(value ?? 1))
    })
    signal?.throwIfAborted()
    if (stalled) throw new Error('FFmpeg stalled for 90 seconds')
    if (code !== 0) throw new Error(`FFmpeg failed: ${errors || code}`)
  } finally {
    clearInterval(watchdog)
    await teardown
    signal?.removeEventListener('abort', onAbort)
    proc.stdout.removeAllListeners()
    proc.stderr.removeAllListeners()
    if (ctx.runtime.child === proc) ctx.runtime.child = null
  }
}

export async function validateMediaOutput(file: string, task: DownloadTask, ctx: EngineContext, duration?: number): Promise<void> {
  await runMediaProcess(['-xerror', '-i', file, '-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-f', 'null', '-'], task, ctx, duration)
  const offsets = [0]
  if (duration && Number.isFinite(duration) && duration > 4) offsets.push(duration - 2)
  for (const offset of offsets) {
    await runMediaProcess(['-xerror', ...(offset ? ['-ss', String(offset)] : []), '-i', file, '-t', '2', '-map', '0:v?', '-map', '0:a?', '-f', 'null', '-'], task, ctx)
  }
}

export function parseMediaRange(header: string, size: number): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2]) || size <= 0) return null
  const suffix = Number(match[2])
  if (!match[1] && (!Number.isSafeInteger(suffix) || suffix <= 0)) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - suffix)
  const requestedEnd = match[1] && match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) return null
  return [start, Math.min(requestedEnd, size - 1)]
}

export class MediaRequestRegistry {
  private readonly active = new Map<() => void, { session: string | null; kind: 'stream' | 'subtitle' | 'probe' }>()
  private readonly closedSessions = new Set<string>()
  private readonly idleWaiters = new Set<{ session: string | null; resolve: () => void }>()
  private stopping = false

  isClosed(session: string | null): boolean {
    return this.stopping || (session !== null && this.closedSessions.has(session))
  }

  track(session: string | null, kind: 'stream' | 'subtitle' | 'probe', stop: () => void): () => void {
    if (this.isClosed(session)) {
      stop()
      return () => {}
    }
    this.active.set(stop, { session, kind })
    return () => {
      this.active.delete(stop)
      this.notifyIdle()
    }
  }

  closeSession(session: string): Promise<void> {
    if (!session || !/^[a-zA-Z0-9-]{1,80}$/.test(session)) return Promise.resolve()
    this.closedSessions.add(session)

    if (this.closedSessions.size > 512) this.closedSessions.delete(this.closedSessions.values().next().value!)
    for (const [stop, entry] of this.active) {
      if (entry.session === session) {
        stop()
      }
    }
    return this.waitForIdle(session)
  }

  closeAll(): Promise<void> {
    this.stopping = true
    for (const stop of this.active.keys()) stop()
    return this.waitForIdle(null)
  }

  private hasActive(session: string | null): boolean {
    return [...this.active.values()].some(entry => session === null || entry.session === session)
  }

  private waitForIdle(session: string | null): Promise<void> {
    if (!this.hasActive(session)) return Promise.resolve()
    return new Promise(resolve => { this.idleWaiters.add({ session, resolve }) })
  }

  private notifyIdle(): void {
    for (const waiter of this.idleWaiters) {
      if (!this.hasActive(waiter.session)) {
        this.idleWaiters.delete(waiter)
        waiter.resolve()
      }
    }
  }

  snapshot(): { streams: number; ffmpegProcesses: number; probeProcesses: number; sessions: number } {
    const entries = [...this.active.values()]
    return {
      streams: entries.filter(entry => entry.kind === 'stream').length,
      ffmpegProcesses: entries.filter(entry => entry.kind === 'subtitle').length,
      probeProcesses: entries.filter(entry => entry.kind === 'probe').length,
      sessions: new Set(entries.map(entry => entry.session).filter(Boolean)).size,
    }
  }
}
