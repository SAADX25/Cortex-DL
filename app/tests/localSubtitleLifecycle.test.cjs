require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), Module = require('node:module')
let recognized = 0, stopped = 0, translated = 0, failTranslation = false, holdRecognition = false, activeChild = false
const originalLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === '../paths') return { getBinaryPath: name => name }
  if (request === '../engineReadiness') return { ensureEnginesReady: async () => {} }
  if (request === '../ytdlp') return { getJsRuntimeArgs: () => [], checkJsRuntime: async () => {} }
  if (request === '../mediaFiles') return { probeMediaFile: async () => ({ format: { duration: '11' }, streams: [{ codec_type: 'audio' }] }) }
  if (request === './process') return { SubtitleProcesses: class {
    constructor(signal) { this.signal = signal }
    async run(binary, args) {
      this.signal.throwIfAborted()
      if (binary === 'whisper') {
        recognized++; activeChild = true
        try {
          if (holdRecognition) await new Promise((resolve, reject) => this.signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true }))
          await fs.writeFile(args[args.indexOf('-of') + 1] + '.json', JSON.stringify({ result: { language: 'en' }, transcription: [
            { offsets: { from: 230, to: 7500 }, text: 'Original speech', tokens: [{ p: .9 }] },
            { offsets: { from: 8180, to: 10380 }, text: 'Another sentence', tokens: [{ p: .95 }] },
          ] }))
        } finally { activeChild = false }
      } else await fs.writeFile(args.at(-1), 'WAV fixture')
    }
    async stop() { stopped++ }
  } }
  if (request === './translator') return { startTranslator: async () => async text => {
    translated++
    if (failTranslation && translated === 2) throw new Error('Translation fixture failed')
    return 'ترجمة ' + text
  } }
  return originalLoad.call(this, request, parent, ...rest)
}
const { LocalSubtitleService } = require('../Back-End/electron/subtitles/service.ts')
const assets = { readiness: async () => ({ speech: { fast: true, accurate: true }, translation: { standard: true, quality: true }, ramGB: 16 }), locate: async key => key }
const request = source => ({ source, sourceLanguage: 'en', targetLanguage: 'ar', speechModel: 'fast', translationModel: 'standard' })
async function fixture(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-local-lifecycle-'))
  const file = path.join(dir, 'source.wav'); await fs.writeFile(file, 'fixture')
  recognized = stopped = translated = 0; failTranslation = holdRecognition = activeChild = false
  try { await run(new LocalSubtitleService(assets), file, dir) } finally { await fs.rm(dir, { recursive: true, force: true }) }
}
async function settled(service) { for (let n = 0; service.busy; n++) { if (n > 500) throw Error('Operation did not settle'); await new Promise(r => setTimeout(r, 10)) } }
test('local subtitle failure retains the complete original transcript and retries translation without repeating recognition', () => fixture(async (service, file, dir) => {
  failTranslation = true
  service.start(request(file)); await settled(service)
  assert.equal(service.state.stage, 'error')
  assert.equal(service.state.document.targetLanguage, 'en')
  assert.deepEqual(service.state.document.cues.map(c => c.text), ['Original speech', 'Another sentence'])
  assert.equal(recognized, 1)
  failTranslation = false; service.start(request(file)); await settled(service)
  assert.equal(service.state.stage, 'ready'); assert.equal(service.state.document.targetLanguage, 'ar'); assert.equal(recognized, 1)
  assert.deepEqual(service.state.document.cues.map(c => [c.start, c.end]), [[.23, 7.5], [8.18, 10.38]])
  const doc = service.state.document, output = path.join(dir, 'output.srt')
  await service.exportDocument(doc.id, doc.cues, 'srt', output)
  assert.match(await fs.readFile(output, 'utf8'), /00:00:08,180 --> 00:00:10,380/)
  await assert.rejects(service.exportDocument('stale-document', doc.cues, 'srt', output), /not ready/)
  assert.equal(stopped, 2)
}))
test('local subtitle cancellation waits for the owning recognition and blocks parallel jobs', () => fixture(async (service, file) => {
  holdRecognition = true
  const id = service.start(request(file))
  assert.throws(() => service.start(request(file)), /BUSY/)
  for (let n = 0; !activeChild; n++) { if (n > 500) throw Error('Recognizer never started'); await new Promise(r => setTimeout(r, 10)) }
  await service.cancel('unrelated'); assert.equal(service.busy, true)
  await service.cancel(id)
  assert.equal(service.state.stage, 'canceled'); assert.equal(activeChild, false); assert.equal(service.busy, false); assert.equal(stopped, 1)
  holdRecognition = false; service.start(request(file)); await settled(service)
  assert.equal(service.state.stage, 'ready')
}))
test('local subtitle memory limits reject the larger translation model before any recognition', () => fixture(async (service, file) => {
  service.start({ ...request(file), translationModel: 'quality' }); await settled(service)
  assert.equal(service.state.error, 'LOCAL_SUBTITLES_MEMORY'); assert.equal(recognized, 0)
}))
