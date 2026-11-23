// Locale registry; keeps Arabic and English catalogs split under ./locales/
import { ar } from './locales/ar'
import { en } from './locales/en'
import type { Language, Translations } from './locales/types'

export type { Language, Translations }

export const defaultLanguage: Language = 'en'

export const translations: Record<Language, Translations> = {
  ar,
  en,
}

export const languageNames: Record<Language, string> = {
  en: 'English',
  ar: 'العربية',
}

// Replaces {key} tokens in localized message templates
export function formatMessage(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''))
}
