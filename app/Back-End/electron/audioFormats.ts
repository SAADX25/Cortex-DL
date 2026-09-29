import type { AudioFormat, TargetFormat } from './types'
import { AUDIO_FORMATS } from './types'

type AudioSpec = {
  ytDlpFormat: string
  codec: string
  containers: readonly string[]
  ffmpegArgs: readonly string[]
}

/** The extension, actual muxer, and audio codec must all agree. */
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

export function isAudioFormat(format: TargetFormat): format is AudioFormat {
  return AUDIO_FORMATS.includes(format as AudioFormat)
}

export function audioOutputArgs(format: AudioFormat, outputPath: string): string[] {
  return ['-vn', ...AUDIO_SPECS[format].ffmpegArgs, outputPath]
}

export type MediaProbe = {
  format?: { format_name?: string }
  streams?: { codec_type?: string; codec_name?: string }[]
}

export function matchesAudioFormat(format: AudioFormat, probe: MediaProbe): boolean {
  const spec = AUDIO_SPECS[format]
  const container = new Set((probe.format?.format_name ?? '').split(','))
  return spec.containers.some(name => container.has(name)) &&
    (probe.streams ?? []).some(stream => stream.codec_type === 'audio' && stream.codec_name === spec.codec)
}
