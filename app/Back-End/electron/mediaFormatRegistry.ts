import type { AudioFormat, TargetFormat, VideoFormat } from './types'
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
  streams?: { codec_type?: string; codec_name?: string; duration?: string; disposition?: { attached_pic?: number } }[]
}

type VideoSpec = { containers: string[]; video: string[]; audio?: string[]; args: string[] }
const VIDEO_SPECS: Record<VideoFormat, VideoSpec> = {
  mp4: { containers: ['mov', 'mp4'], video: ['h264', 'hevc', 'mpeg4', 'av1'], audio: ['aac', 'mp3', 'alac'], args: ['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', '-f', 'mp4'] },
  m4v: { containers: ['mov', 'mp4'], video: ['h264', 'hevc', 'mpeg4'], audio: ['aac', 'alac'], args: ['-c:v', 'libx264', '-c:a', 'aac', '-f', 'mp4'] },
  mov: { containers: ['mov'], video: ['h264', 'hevc', 'mpeg4', 'prores', 'mjpeg'], audio: ['aac', 'alac', 'pcm_s16le'], args: ['-c:v', 'libx264', '-c:a', 'aac', '-f', 'mov'] },
  mkv: { containers: ['matroska'], video: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'theora', 'mjpeg', 'prores'], args: ['-c:v', 'libx264', '-c:a', 'aac', '-f', 'matroska'] },
  webm: { containers: ['webm'], video: ['vp8', 'vp9', 'av1'], audio: ['opus', 'vorbis'], args: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '5', '-c:a', 'libopus', '-f', 'webm'] },
  avi: { containers: ['avi'], video: ['mpeg4', 'h264', 'mjpeg'], audio: ['mp3', 'pcm_s16le'], args: ['-c:v', 'mpeg4', '-c:a', 'libmp3lame', '-f', 'avi'] },
  ogv: { containers: ['ogg'], video: ['theora'], audio: ['vorbis'], args: ['-c:v', 'libtheora', '-c:a', 'libvorbis', '-f', 'ogg'] },
  gif: { containers: ['gif'], video: ['gif'], args: ['-an', '-vf', 'fps=15,scale=480:-1:flags=lanczos', '-f', 'gif'] },
}

/** Registry controls encoding and validation for every selectable format. */
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

export function mediaOutputArgs(format: TargetFormat, output: string, source?: MediaProbe, trim = false): string[] {
  const spec = MediaFormatRegistry[format]
  const compatible = source && matchesMediaFormat(format, { ...source, format: { format_name: spec.container.join(',') } })
  const mapping: string[] = []
  const subtitleArgs: string[] = []
  if (spec.videoCodec && format !== 'gif') {
    mapping.push('-map', '0:v:0', '-map', '0:a?')
    if (source?.streams?.some(s => s.codec_type === 'subtitle') && ['mp4', 'mov', 'm4v', 'mkv'].includes(format)) {
      mapping.push('-map', '0:s?')
      subtitleArgs.push('-c:s', format === 'mkv' ? 'copy' : 'mov_text')
    }
  }
  if (!trim && compatible && format !== 'gif') {
    const muxer = format === 'm4v' ? 'mp4' : format === 'm4a' ? 'ipod' : format === 'mkv' ? 'matroska' : format === 'aac' ? 'adts' : format === 'wma' ? 'asf' : format === 'ogv' ? 'ogg' : format
    return [...mapping, ...(spec.videoCodec === null ? ['-vn'] : []), '-c', 'copy', ...subtitleArgs, '-map_metadata', '0', '-f', muxer, output]
  }
  // Accurate cuts always encode. Container-compatible subtitles are retained.
  return [...mapping, ...spec.ffmpegArgs, ...subtitleArgs, '-map_metadata', '0', output]
}
