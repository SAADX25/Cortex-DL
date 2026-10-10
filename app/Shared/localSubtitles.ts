export const SUBTITLE_LANGUAGES = {
  ar: 'Arabic', en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', ru: 'Russian', tr: 'Turkish', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
  hi: 'Hindi', fa: 'Persian', ur: 'Urdu', nl: 'Dutch', pl: 'Polish', uk: 'Ukrainian',
} as const
export type SubtitleLanguage = keyof typeof SUBTITLE_LANGUAGES
export type SpeechModel = 'accurate' | 'fast'
export type TranslationModel = 'standard' | 'quality'
export type SubtitleCue = { id: number; start: number; end: number; text: string; original: string; review: boolean }
export type SubtitleDocument = { id: string; name: string; sourceLanguage: string; targetLanguage: string; duration: number; cues: SubtitleCue[]; localFile?: string }
export type SubtitlePreview = { language: string; vtt: string }
export type SubtitleRequest = { source: string; sourceLanguage: SubtitleLanguage | 'auto'; targetLanguage: SubtitleLanguage | 'original'; speechModel: SpeechModel; translationModel: TranslationModel }
export type SubtitleState = {
  id: string; stage: 'idle' | 'installing' | 'preparing' | 'transcribing' | 'translating' | 'exporting' | 'ready' | 'canceled' | 'error';
  progress: number | null; detail?: string; error?: string; document?: SubtitleDocument
}
export type SubtitleReadiness = { speech: Record<SpeechModel, boolean>; translation: Record<TranslationModel, boolean>; ramGB: number }
export function isSubtitleLanguage(value: unknown): value is SubtitleLanguage {
  return typeof value === 'string' && Object.hasOwn(SUBTITLE_LANGUAGES, value)
}
export function validateSubtitleRequest(value: unknown): asserts value is SubtitleRequest {
  const r = value as SubtitleRequest
  if (!r || typeof r.source !== 'string' || !r.source.trim() || r.source.length > 32767 || r.source.includes('\0')
    || !(r.sourceLanguage === 'auto' || isSubtitleLanguage(r.sourceLanguage))
    || !(r.targetLanguage === 'original' || isSubtitleLanguage(r.targetLanguage))
    || !['accurate', 'fast'].includes(r.speechModel) || !['standard', 'quality'].includes(r.translationModel)) throw new Error('Invalid subtitle request')
}
