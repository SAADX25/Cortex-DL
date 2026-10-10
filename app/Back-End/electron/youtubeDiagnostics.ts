import log from 'electron-log'
import { youtubeErrorCode } from '../../Shared/youtubeErrors'
import { buildInfo } from './diagnostics'

/** Keep diagnostic categories, never extractor URLs, tokens or account data. */
export function diagnosticCategories(text: string): string[] {
  const categories = new Set<string>()
  const code = youtubeErrorCode(text)
  if (code) categories.add(code)
  if (/JavaScript runtime|challenge solving|n challenge|signature extraction/i.test(text)) categories.add('js-challenge')
  if (/SABR|formats have been skipped|missing a url/i.test(text)) categories.add('formats-skipped')
  if (/subtitle|caption/i.test(text) && /WARNING|ERROR/i.test(text)) categories.add('caption-warning')
  return [...categories]
}

export function youtubeDiagnostic(event: string, data: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'development' || process.env.CORTEX_YOUTUBE_DEBUG === '1') {
    log.info('[youtube diagnostic]', { event, app: buildInfo(), ...data })
  }
}
