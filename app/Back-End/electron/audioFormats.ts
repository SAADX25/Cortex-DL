import type { AudioFormat, TargetFormat } from './types'
import { AUDIO_FORMATS } from './types'
import { AUDIO_SPECS, matchesMediaFormat } from './mediaFormatRegistry'
import type { MediaProbe } from './mediaFormatRegistry'
export { AUDIO_SPECS }
export type { MediaProbe }
export function isAudioFormat(format: TargetFormat): format is AudioFormat {
  return AUDIO_FORMATS.includes(format as AudioFormat)
}
export function audioOutputArgs(format: AudioFormat, outputPath: string): string[] {
  return ['-vn', ...AUDIO_SPECS[format].ffmpegArgs, outputPath]
}
export function matchesAudioFormat(format: AudioFormat, probe: MediaProbe): boolean {
  return matchesMediaFormat(format, probe)
}
