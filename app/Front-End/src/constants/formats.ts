import { AUDIO_FORMATS as SHARED_AUDIO_FORMATS } from '../../../Shared/types'

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

export const AUDIO_FORMATS: FormatOption[] = SHARED_AUDIO_FORMATS.map(value => ({ value, label: value.toUpperCase() }))

export const FORMAT_GROUPS = [
  { label: 'VIDEO', options: VIDEO_FORMATS },
  { label: 'AUDIO', options: AUDIO_FORMATS },
]

export const ALL_FORMAT_VALUES = [...VIDEO_FORMATS, ...AUDIO_FORMATS].map((f) => f.value)

export type TargetFormatValue = typeof ALL_FORMAT_VALUES[number]
