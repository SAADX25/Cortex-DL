import type { SubtitleCue } from './localSubtitles'

function cleanText(text: string): string { return text.replace(/\[_[^\]]*\]/g, '').replace(/\s+/gu, ' ').trim() }
export function validateCues(cues: unknown, duration: number): asserts cues is SubtitleCue[] {
  if (!Array.isArray(cues) || !cues.length || cues.length > 50000 || !Number.isFinite(duration) || duration <= 0) throw new Error('No valid speech captions')
  let end = 0
  const ids = new Set<number>()
  for (const c of cues) {
    if (!c || !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < end - 0.001 || c.end <= c.start || c.end > duration + 0.1
      || !Number.isInteger(c.id) || c.id < 1 || ids.has(c.id) || typeof c.original !== 'string' || c.original.length > 4000 || typeof c.review !== 'boolean'
      || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 4000 || c.text.includes('\0') || /-->|[\r\n]{2}/.test(c.text)) throw new Error('Invalid subtitle timing or text')
    ids.add(c.id)
    end = c.end
  }
}
/** Keep recognizer timing in seconds. Never shift speech earlier to fill silence. */
export function parseWhisperDocument(value: unknown, duration: number): { language: string; cues: SubtitleCue[] } {
  const doc = value as { result?: { language?: string }; transcription?: { offsets?: { from?: number; to?: number }; text?: string; tokens?: { p?: number }[] }[] }
  if (!doc || !Array.isArray(doc.transcription)) throw new Error('Invalid speech engine output')
  const cues: SubtitleCue[] = []
  for (const segment of doc.transcription) {
    const text = cleanText(segment.text ?? '')
    if (!text) continue
    const rawStart = Number(segment.offsets?.from) / 1000
    if (!Number.isFinite(rawStart) || rawStart < 0) throw new Error('Speech engine returned invalid timing')
    const start = Math.max(cues.at(-1)?.end ?? 0, rawStart)
    const end = Math.min(duration, Number(segment.offsets?.to) / 1000)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('Speech engine returned invalid timing')
    const tokens = segment.tokens?.filter(t => Number.isFinite(t.p)) ?? []
    const confidence = tokens.length ? tokens.reduce((sum, t) => sum + t.p!, 0) / tokens.length : 1
    cues.push({ id: cues.length + 1, start, end, text, original: text, review: confidence < 0.55 || text.length > 84 || text.length / (end - start) > 25 })
  }
  validateCues(cues, duration)
  return { language: doc.result?.language ?? '', cues }
}
export function subtitleTimestamp(seconds: number, srt = false): string {
  const ms = Math.round(seconds * 1000)
  return `${Math.floor(ms / 3600000).toString().padStart(2, '0')}:${Math.floor(ms / 60000 % 60).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}${srt ? ',' : '.'}${(ms % 1000).toString().padStart(3, '0')}`
}
function wrapText(text: string): string {
  const words = text.trim().split(/\s+/u), lines = ['']
  for (const word of words) {
    const last = lines.length - 1
    if (lines[last] && Array.from(lines[last] + ' ' + word).length > 42) lines.push(word)
    else lines[last] += (lines[last] ? ' ' : '') + word
  }
  return lines.join('\n')
}
export function serializeSubtitles(cues: SubtitleCue[], duration: number, format: 'srt' | 'vtt'): string {
  validateCues(cues, duration)
  const srt = format === 'srt'
  return (srt ? '' : 'WEBVTT\n\n') + cues.map((cue, i) => `${i + 1}\n${subtitleTimestamp(cue.start, srt)} --> ${subtitleTimestamp(cue.end, srt)}\n${wrapText(cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))}\n`).join('\n')
}
