require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), Module = require('node:module')
let recognized = 0, stopped = 0, translated = 0, failTranslation = false, holdRecognition = false, activeChild = false
let outputMode = 'speech', recognitionArgs = [], onRecognized = () => {}, mediaDuration = 11
let gpuFixture = null, gpuFailure = false, translatorGpuFailure = false, gpuAssets = true, recognitionBinaries = [], translatorConfigs = []
const gpuHelpers = require('../Back-End/electron/subtitles/gpu.ts')
const originalLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === '../paths') return { getBinaryPath: name => name }
  if (request === '../engineReadiness') return { ensureEnginesReady: async () => {} }
  if (request === '../ytdlp') return { getJsRuntimeArgs: () => [], checkJsRuntime: async () => {} }
  if (request === '../mediaFiles') return { probeMediaFile: async () => ({ format: { duration: String(mediaDuration) }, streams: [{ codec_type: 'audio' }] }) }
  if (request === './gpu') return { ...gpuHelpers, detectNvidiaGpu: async () => gpuFixture }
  if (request === './process') return { SubtitleProcesses: class {
    constructor(signal) { this.signal = signal }
    async run(binary, args, onOutput) {
      this.signal.throwIfAborted()
      if (binary === 'llamaGpu') { onOutput?.('Available devices:\nVulkan0: NVIDIA GeForce GTX 1050 Ti (4096 MiB, 3000 MiB free)'); return }
      if (binary === 'whisper' || binary === 'whisperGpu') {
        recognized++; recognitionArgs.push(args); recognitionBinaries.push(binary); activeChild = true
        try {
          if (binary === 'whisperGpu' && gpuFailure) throw Error('GPU memory allocation failed')
          if (binary === 'whisperGpu') {
            onOutput?.('whisper_model_load: CUDA0 total size = 1080.47 MB'); onOutput?.('x'.repeat(15000))
            if (args.includes('--vad')) onOutput?.('whisper_vad_init_with_params: CPU total size = 0.88 MB\nwhisper_backend_init_gpu: no GPU found')
          }
          if (holdRecognition) await new Promise((resolve, reject) => this.signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true }))
          const transcription = outputMode === 'invalid-timing' ? [{ offsets: { from: 7500, to: 7500 }, text: 'كلام عربي' }]
            : outputMode === 'vad-timing' && args.includes('--vad') ? [
              { offsets: { from: 11450, to: 14000 }, text: 'شوف بس شوف' },
              { offsets: { from: 14000, to: 14100 }, text: 'كلام عربي' },
              { offsets: { from: 14000, to: 14100 }, text: 'كلام عربي' },
            ]
            : outputMode === 'empty' ? [] : outputMode === 'music-only' || outputMode === 'retry' && args.includes('--vad') ? [{ offsets: { from: 70, to: 570 }, text: '♪' }] : [
            { offsets: { from: 230, to: 7500 }, text: 'Original speech', tokens: [{ p: .9 }] },
            { offsets: { from: 8180, to: 10380 }, text: 'Another sentence', tokens: [{ p: .95 }] },
          ]
          await fs.writeFile(args[args.indexOf('-of') + 1] + '.json', JSON.stringify({ result: { language: 'en' }, transcription }))
          onRecognized()
        } finally { activeChild = false }
      } else await fs.writeFile(args.at(-1), 'WAV fixture')
    }
    async stop() { stopped++ }
  } }
  if (request === './translator') return { startTranslator: async (binary, model, processes, gpu) => {
    translatorConfigs.push({ binary, gpu })
    if (gpu && translatorGpuFailure) throw Error('Vulkan allocation failed')
    return async text => {
    translated++
    if (failTranslation && translated === 2) throw new Error('Translation fixture failed')
    return 'ترجمة ' + text
  } } }
  return originalLoad.call(this, request, parent, ...rest)
}
const { LocalSubtitleService } = require('../Back-End/electron/subtitles/service.ts')
const assets = { readiness: async () => ({ speech: { fast: true, accurate: true }, translation: { standard: true, quality: true }, ramGB: 16, gpu: gpuFixture ? { speech: { fast: gpuAssets, accurate: gpuAssets }, translation: gpuAssets } : undefined }), locate: async key => !gpuAssets && ['whisperGpu', 'cudaLibraries', 'accurateGpu', 'llamaGpu'].includes(key) ? null : key }
const request = source => ({ source, sourceLanguage: 'en', targetLanguage: 'ar', speechModel: 'fast', translationModel: 'standard' })
async function fixture(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-local-lifecycle-'))
  const file = path.join(dir, 'source.wav'); await fs.writeFile(file, 'fixture')
  recognized = stopped = translated = 0; failTranslation = holdRecognition = activeChild = false
  outputMode = 'speech'; recognitionArgs = []; onRecognized = () => {}; mediaDuration = 11
  gpuFixture = null; gpuFailure = translatorGpuFailure = false; gpuAssets = true; recognitionBinaries = []; translatorConfigs = []
  try { await run(new LocalSubtitleService(assets), file, dir) } finally { await fs.rm(dir, { recursive: true, force: true }) }
}
async function settled(service) { for (let n = 0; service.busy; n++) { if (n > 500) throw Error('Operation did not settle'); await new Promise(r => setTimeout(r, 10)) } }
test('clearing a subtitle session erases results and speech cache while preserving saved exports and source media', () => fixture(async (service, file, dir) => {
  service.start(request(file)); await settled(service)
  const doc = service.state.document, output = path.join(dir, 'saved.srt')
  await service.exportDocument(doc.id, doc.cues, 'srt', output)
  const saved = await fs.readFile(output, 'utf8')
  assert.deepEqual(service.clear(service.state.id), { id: '', stage: 'idle', progress: null })
  assert.equal(await fs.readFile(output, 'utf8'), saved)
  assert.equal(await fs.readFile(file, 'utf8'), 'fixture')
  await assert.rejects(service.exportDocument(doc.id, doc.cues, 'srt', output), /not ready/)
  service.start(request(file)); await settled(service)
  assert.equal(recognized, 2, 'Clearing must discard the cached original transcript too')
  assert.throws(() => service.clear(doc.id), /session has changed/)
  assert.equal(service.state.stage, 'ready')
}))
test('clearing refuses an active job, and full shutdown waits for cancellation then erases session data', () => fixture(async (service, file) => {
  service.start(request(file)); await settled(service)
  holdRecognition = true
  service.start({ ...request(file), recognitionMode: 'music' })
  assert.throws(() => service.clear(service.state.id), /BUSY/)
  for (let n = 0; !activeChild; n++) { if (n > 500) throw Error('Recognizer never started'); await new Promise(r => setTimeout(r, 10)) }
  await service.dispose()
  assert.equal(activeChild, false); assert.equal(service.busy, false)
  assert.deepEqual(service.state, { id: '', stage: 'idle', progress: null })
  holdRecognition = false
  service.start(request(file)); await settled(service)
  assert.equal(recognized, 3, 'Shutdown must release the previous cached transcript')
}))
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
test('music-only recognition retries the full audio once and translates actual words with original timing', () => fixture(async (service, file) => {
  outputMode = 'retry'
  service.start(request(file)); await settled(service)
  assert.equal(service.state.stage, 'ready', service.state.error)
  assert.equal(recognized, 2); assert.equal(translated, 2)
  assert.equal(recognitionArgs[0].includes('--vad'), true); assert.equal(recognitionArgs[1].includes('--vad'), false)
  assert.deepEqual(service.state.document.cues.map(c => [c.start, c.end]), [[.23, 7.5], [8.18, 10.38]])
  service.start(request(file)); await settled(service)
  assert.equal(recognized, 2, 'Only meaningful speech is cached')
}))
test('singing mode bypasses VAD and invalidates a transcript cached for dialogue', () => fixture(async (service, file) => {
  service.start(request(file)); await settled(service)
  service.start({ ...request(file), recognitionMode: 'music' }); await settled(service)
  assert.equal(recognized, 2)
  assert.equal(recognitionArgs[1].includes('--vad'), false)
  assert.equal(service.state.stage, 'ready')
}))

test('recognition resets noisy context and uses natural timing, with a balanced Turbo search and wider accuracy search', () => fixture(async (service, file) => {
  service.start(request(file)); await settled(service)
  let args = recognitionArgs.at(-1)
  assert.equal(args[args.indexOf('-bs') + 1], '3'); assert.equal(args[args.indexOf('-bo') + 1], '3')
  assert.equal(args[args.indexOf('-mc') + 1], '0')
  assert.equal(args.includes('-sow'), false); assert.equal(args.includes('-ml'), false)
  service.start({ ...request(file), speechModel: 'accurate' }); await settled(service)
  args = recognitionArgs.at(-1)
  assert.equal(args[args.indexOf('-bs') + 1], '5'); assert.equal(args[args.indexOf('-bo') + 1], '5')
  assert.equal(args[args.indexOf('-mc') + 1], '0')
}))

test('invalid VAD timing on a twenty-minute video retries full audio once and preserves valid speech timing', () => fixture(async (service, file) => {
  mediaDuration = 20 * 60; outputMode = 'vad-timing'
  service.start({ ...request(file), sourceLanguage: 'ar', targetLanguage: 'ar' }); await settled(service)
  assert.equal(service.state.stage, 'ready', service.state.error)
  assert.equal(recognized, 2); assert.equal(translated, 0, 'Arabic speech to Arabic captions needs no translation model')
  assert.deepEqual(recognitionArgs.map(args => args.includes('--vad')), [true, false])
  assert.equal(service.state.document.duration, 1200)
  assert.deepEqual(service.state.document.cues.map(c => [c.start, c.end]), [[.23, 7.5], [8.18, 10.38]])
  assert.equal(service.state.detail, undefined)
}))

test('persistent invalid timing fails after one retry without inventing timestamps or caching a document', () => fixture(async (service, file) => {
  outputMode = 'invalid-timing'
  service.start(request(file)); await settled(service)
  assert.equal(service.state.error, 'Speech engine returned invalid timing')
  assert.equal(recognized, 2); assert.equal(translated, 0); assert.equal(service.state.document, undefined)
  const before = recognized
  service.start({ ...request(file), recognitionMode: 'music' }); await settled(service)
  assert.equal(recognized - before, 1, 'Full audio must not retry itself')
  assert.equal(service.state.error, 'Speech engine returned invalid timing')
}))

test('canceling invalid timing recognition prevents the full-audio retry', () => fixture(async (service, file) => {
  outputMode = 'vad-timing'
  const id = service.start(request(file))
  onRecognized = () => { void service.cancel(id) }
  await settled(service)
  assert.equal(service.state.stage, 'canceled'); assert.equal(recognized, 1); assert.equal(translated, 0)
}))
test('empty or non-verbal audio reports no speech, starts no translator, and caches no successful transcript', () => fixture(async (service, file) => {
  for (const mode of ['music-only', 'empty']) {
    outputMode = mode
    const before = recognized
    service.start(request(file)); await settled(service)
    assert.equal(service.state.error, 'LOCAL_SUBTITLES_NO_SPEECH'); assert.equal(service.state.document, undefined)
    assert.equal(recognized - before, 2); assert.equal(translated, 0)
  }
  const before = recognized
  service.start({ ...request(file), recognitionMode: 'music' }); await settled(service)
  assert.equal(recognized - before, 1); assert.equal(service.state.error, 'LOCAL_SUBTITLES_NO_SPEECH')
}))
test('canceling a non-verbal first pass prevents the full-audio retry', () => fixture(async (service, file) => {
  outputMode = 'music-only'
  const id = service.start(request(file))
  onRecognized = () => { void service.cancel(id) }
  await settled(service)
  assert.equal(service.state.stage, 'canceled'); assert.equal(recognized, 1); assert.equal(translated, 0)
}))
const installedGpu = { index: 0, name: 'NVIDIA GeForce GTX 1050 Ti', memoryMB: 4096, freeMB: 3000, capability: 6.1 }
test('GPU recognition confirms its backend even after long output and translation uses a memory budget', () => fixture(async (service, file) => {
  gpuFixture = installedGpu
  service.start({ ...request(file), speechModel: 'accurate', recognitionMode: 'music' }); await settled(service)
  assert.equal(service.state.stage, 'ready', service.state.error)
  assert.deepEqual(recognitionBinaries, ['whisperGpu'])
  assert.equal(service.state.acceleration.speech, 'gpu'); assert.equal(service.state.acceleration.translation, 'gpu'); assert.equal(service.state.acceleration.compact, true)
  assert.equal(translatorConfigs[0].gpu.device, 'Vulkan0'); assert.ok(translatorConfigs[0].gpu.layers > 0 && translatorConfigs[0].gpu.layers < 34)
}))
test('GPU recognition and translation startup failures fall back to CPU once and keep real timing', () => fixture(async (service, file) => {
  gpuFixture = installedGpu; gpuFailure = translatorGpuFailure = true
  service.start(request(file)); await settled(service)
  assert.equal(service.state.stage, 'ready', service.state.error)
  assert.deepEqual(recognitionBinaries, ['whisperGpu', 'whisper'])
  assert.deepEqual(translatorConfigs.map(c => c.binary), ['llamaGpu', 'llama'])
  assert.equal(service.state.acceleration.speech, 'cpu'); assert.equal(service.state.acceleration.translation, 'cpu')
  assert.deepEqual(service.state.document.cues.map(c => [c.start, c.end]), [[.23, 7.5], [8.18, 10.38]])
}))
test('CPU voice activity detection does not overwrite a confirmed CUDA speech backend', () => fixture(async (service, file) => {
  gpuFixture = installedGpu
  service.start({ ...request(file), targetLanguage: 'original' }); await settled(service)
  assert.equal(service.state.stage, 'ready', service.state.error)
  assert.equal(recognitionArgs[0].includes('--vad'), true)
  assert.equal(service.state.acceleration.speech, 'gpu')
  assert.equal(service.state.detail, undefined)
  assert.deepEqual(recognitionBinaries, ['whisperGpu'])
}))
test('CPU override avoids GPU engines, and newly prepared GPU engines invalidate a CPU recognition cache', () => fixture(async (service, file) => {
  gpuFixture = installedGpu; gpuAssets = false
  service.start(request(file)); await settled(service)
  gpuAssets = true
  service.start(request(file)); await settled(service)
  assert.deepEqual(recognitionBinaries, ['whisper', 'whisperGpu'])
  service.start({ ...request(file), compute: 'cpu' }); await settled(service)
  assert.deepEqual(recognitionBinaries, ['whisper', 'whisperGpu', 'whisper'])
  assert.equal(translatorConfigs.at(-1).binary, 'llama'); assert.equal(translatorConfigs.at(-1).gpu, undefined)
}))
test('canceling GPU recognition prevents CPU fallback and translation', () => fixture(async (service, file) => {
  gpuFixture = installedGpu; holdRecognition = true
  const id = service.start(request(file))
  for (let n = 0; !activeChild; n++) { if (n > 500) throw Error('GPU did not start'); await new Promise(r => setTimeout(r, 10)) }
  await service.cancel(id)
  assert.equal(service.state.stage, 'canceled'); assert.deepEqual(recognitionBinaries, ['whisperGpu']); assert.equal(translatorConfigs.length, 0)
}))
