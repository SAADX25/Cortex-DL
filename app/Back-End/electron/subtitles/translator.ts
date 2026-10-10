import net from 'node:net'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { SUBTITLE_LANGUAGES, isSubtitleLanguage, type SubtitleLanguage } from '../../../Shared/localSubtitles'
import { SubtitleProcesses } from './process'

export function translationPrompt(text: string, source: SubtitleLanguage, target: SubtitleLanguage): string {
  const from = SUBTITLE_LANGUAGES[source], to = SUBTITLE_LANGUAGES[target]
  // TranslateGemma's documented single-user-turn format. No cloud/API dependency.
  return `<bos><start_of_turn>user\nYou are a professional ${from} (${source}) to ${to} (${target}) translator. Your goal is to accurately convey the meaning and nuances of the original ${from} text while adhering to ${to} grammar, vocabulary, and cultural sensitivities.\nProduce only the ${to} translation, without any additional explanations or commentary. Please translate the following ${from} text into ${to}:\n\n\n${text}<end_of_turn>\n<start_of_turn>model\n`
}
export function validateTranslation(value: unknown, source: string): string {
  if (typeof value !== 'string') throw new Error('Invalid translation engine response')
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text || text.length > Math.max(1000, source.length * 12) || /<\|?|```|-->|\[_/.test(text)) throw new Error('Translation output needs review; original transcript retained')
  return text
}
export async function startTranslator(binary: string, model: string, processes: SubtitleProcesses): Promise<(text: string, source: string, target: SubtitleLanguage) => Promise<string>> {
  const port = await new Promise<number>((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const port = (server.address() as net.AddressInfo).port; server.close(() => resolve(port)) })
  })
  const token = randomUUID(), origin = `http://127.0.0.1:${port}`
  let stopped = false
  const run = processes.spawn(binary, ['-m', model, '--host', '127.0.0.1', '--port', String(port), '--api-key', token,
    '--ctx-size', '4096', '--parallel', '1', '--threads', String(Math.max(1, Math.min(8, os.availableParallelism() - 2))), '-ngl', '0'])
  void run.settled.then(() => { stopped = true }, () => { stopped = true })
  const deadline = Date.now() + 180000
  for (;;) {
    processes.signal.throwIfAborted()
    if (stopped) { await run.settled; throw new Error('Translation engine stopped') }
    const ready = await fetch(origin + '/health', { signal: AbortSignal.any([processes.signal, AbortSignal.timeout(1000)]), headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok, () => false)
    if (ready) break
    if (Date.now() >= deadline) throw new Error('Translation model load timed out')
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return async (text, source, target) => {
    if (!isSubtitleLanguage(source)) throw new Error('Detected language is not supported for local translation. Select the spoken language.')
    const response = await fetch(origin + '/completion', { method: 'POST', signal: AbortSignal.any([processes.signal, AbortSignal.timeout(180000)]),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ prompt: translationPrompt(text, source, target), temperature: 0, n_predict: 2048,
        cache_prompt: true, stream: false, stop: ['<end_of_turn>', '<eos>'] }) })
    if (!response.ok) throw new Error(`Local translation failed (${response.status})`)
    const result = await response.json() as { content?: string; truncated?: boolean; stop_type?: string }
    if (result.truncated || result.stop_type === 'limit') throw new Error('Translation was truncated; original transcript retained')
    return validateTranslation(result.content, text)
  }
}
