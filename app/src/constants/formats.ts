export type FormatOption = { value: string; label: string }

export const VIDEO_FORMATS: FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WEBM' },
  { value: 'mkv', label: 'MKV' },
]

export const AUDIO_FORMATS: FormatOption[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4a', label: 'M4A' },
  { value: 'flac', label: 'FLAC' },
  { value: 'wav', label: 'WAV' },
]

export const FORMAT_GROUPS = [
  { label: 'VIDEO', options: VIDEO_FORMATS },
  { label: 'AUDIO', options: AUDIO_FORMATS },
]

export const ALL_FORMAT_VALUES = [...VIDEO_FORMATS, ...AUDIO_FORMATS].map((f) => f.value)

export type TargetFormatValue = typeof ALL_FORMAT_VALUES[number]
