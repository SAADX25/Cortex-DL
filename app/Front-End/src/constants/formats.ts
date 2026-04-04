export type FormatOption = { value: string; label: string }

export const VIDEO_FORMATS: FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mkv', label: 'MKV' },
  { value: 'avi', label: 'AVI' },
  { value: 'mov', label: 'MOV' },
  { value: 'webm', label: 'WEBM' },
  { value: 'ogv', label: 'OGV' },
  { value: 'm4v', label: 'M4V' },
]

export const AUDIO_FORMATS: FormatOption[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'm4a', label: 'M4A' },
  { value: 'ogg', label: 'OGG' },
  { value: 'flac', label: 'FLAC' },
  { value: 'aac', label: 'AAC' },
  { value: 'opus', label: 'OPUS' },
  { value: 'wma', label: 'WMA' },
]

export const FORMAT_GROUPS = [
  { label: 'VIDEO', options: VIDEO_FORMATS },
  { label: 'AUDIO', options: AUDIO_FORMATS },
]

export const ALL_FORMAT_VALUES = [...VIDEO_FORMATS, ...AUDIO_FORMATS].map((f) => f.value)

export type TargetFormatValue = typeof ALL_FORMAT_VALUES[number]
