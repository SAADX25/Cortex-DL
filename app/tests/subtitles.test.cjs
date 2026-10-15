const { suite } = require('./register-ts.cjs')

suite('Local captions', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const http = require('node:http')
  const { createHash } = require('node:crypto')
  const Module = require('node:module')
  const originalLoad = Module._load
  Module._load = function(request, parent, ...rest) {
    if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
    return originalLoad.call(this, request, parent, ...rest)
  }
  const { SUBTITLE_LANGUAGES, validateSubtitleRequest } = require('../Shared/localSubtitles.ts')
  const { parseWhisperDocument, parseSpeechRecognition, hasSpokenText, serializeSubtitles, validateCues } = require('../Shared/subtitleCues.ts')
  const { translationPrompt, validateTranslation } = require('../Back-End/electron/subtitles/translator.ts')
  const { SubtitleAssets } = require('../Back-End/electron/subtitles/assets.ts')
  const { SUBTITLE_ASSETS } = require('../Back-End/electron/subtitles/manifest.ts')
  const { SubtitleProcesses } = require('../Back-End/electron/subtitles/process.ts')
  const { parseNvidiaDevices, translationGpuLayers, selectVulkanDevice } = require('../Back-End/electron/subtitles/gpu.ts')
  const cue = (id, start, end, text = 'Hello & welcome <friend>') => ({ id, start, end, text, original: text, review: false })
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  async function sandbox(run) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-local-caption-test-'))
    try { await run(dir) } finally { await fs.rm(dir, { recursive: true, force: true }) }
  }
  async function server(run, respond) {
    const server = http.createServer(respond)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try { await run(`http://127.0.0.1:${server.address().port}`) }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  }
  test('local subtitle timing preserves real speech gaps and flags uncertain recognition', () => {
    const recognized = parseWhisperDocument({ result: { language: 'ar' }, transcription: [
      { offsets: { from: 230, to: 1800 }, text: '  مرحبًا   بك ', tokens: [{ p: .92 }] },
      { offsets: { from: 3200, to: 5400 }, text: 'المقطع الثاني', tokens: [{ p: .4 }] },
    ] }, 11)
    assert.equal(recognized.language, 'ar')
    assert.deepEqual(recognized.cues.map(c => [c.start, c.end]), [[.23, 1.8], [3.2, 5.4]])
    assert.equal(recognized.cues[0].text, 'مرحبًا بك')
    assert.equal(recognized.cues[0].review, false)
    assert.equal(recognized.cues[1].review, true)
    for (const offsets of [{ from: -1, to: 20 }, { from: 200, to: 100 }, { from: 'bad', to: 100 }]) {
      assert.throws(() => parseWhisperDocument({ transcription: [{ offsets, text: 'invalid' }] }, 11), /timing/)
    }
    assert.throws(() => parseWhisperDocument({ transcription: [] }, 11), /No valid speech/)
  })
  test('local subtitle exports round milliseconds, escape markup, and reject overlap, drift or duplicate IDs', () => {
    const cues = [cue(1, .2304, 1.8), cue(2, 3661.9996, 3665.2, 'ترجمة عربية')]
    const srt = serializeSubtitles(cues, 3670, 'srt')
    assert.match(srt, /00:00:00,230 --> 00:00:01,800/)
    assert.match(srt, /01:01:02,000 --> 01:01:05,200/)
    assert.match(srt, /&amp; welcome &lt;friend&gt;/)
    assert.match(serializeSubtitles(cues, 3670, 'vtt'), /^WEBVTT\n\n1\n00:00:00\.230/)
    for (const invalid of [[cue(1, -1, 2)], [cue(1, 1, 1)], [cue(1, 0, 2), cue(2, 1, 4)], [cue(1, 0, 20)],
      [cue(1, 0, 2), cue(1, 3, 4)], [cue(1, 0, 2, '')], [cue(1, 0, 2, '00:00 --> invalid')]]) assert.throws(() => validateCues(invalid, 10), /Invalid/)
  })
  test('recognition distinguishes music events from multilingual speech without hiding malformed output', () => {
    for (const text of ['♪', '♫ ♪', '[Music]', '(instrumental music)', '[Applause] ♪', 'موسيقى', '...']) assert.equal(hasSpokenText(text), false, text)
    for (const text of ['♪ Hello world ♪', 'مرحبًا بك', '你好', '123', '[a real sentence]']) assert.equal(hasSpokenText(text), true, text)
    const segment = (text, from = 70, to = 570) => ({ text, offsets: { from, to } })
    assert.equal(parseSpeechRecognition({ transcription: [segment('♪')] }, 11), null)
    assert.equal(parseSpeechRecognition({ transcription: [] }, 11), null)
    const parsed = parseSpeechRecognition({ transcription: [segment('[Music]'), segment('كلام واضح', 3200, 5400)] }, 11)
    assert.deepEqual(parsed.cues.map(c => [c.id, c.start, c.end, c.text]), [[1, 3.2, 5.4, 'كلام واضح']])
    assert.throws(() => parseSpeechRecognition({ transcription: [segment('♪', -1)] }, 11), /timing/)
    assert.throws(() => parseSpeechRecognition({}, 11), /Invalid speech/)
  })
  test('repeated recognition phrases need review without deleting speech or changing its audio offsets', () => {
    const transcription = ['جملة أخرى', 'أنا محامي', 'أنا محامي', 'أنا محامي', 'أنا محامي', 'نهاية الكلام'].map((text, i) => ({
      text, offsets: { from: i * 2000, to: i * 2000 + 1500 }, tokens: [{ p: .98 }],
    }))
    const parsed = parseSpeechRecognition({ result: { language: 'ar' }, transcription }, 12)
    assert.deepEqual(parsed.cues.map(c => c.review), [false, true, true, true, true, false])
    assert.deepEqual(parsed.cues.map(c => [c.text, c.start, c.end]), transcription.map(c => [c.text, c.offsets.from / 1000, c.offsets.to / 1000]))
  })

  test('local translation uses the model template and refuses empty or truncated-looking output', () => {
    const prompt = translationPrompt('Hello, how are you?', 'en', 'ar')
    assert.match(prompt, /English \(en\) to Arabic \(ar\)/)
    assert.match(prompt, /\n\n\nHello, how are you\?<end_of_turn>/)
    assert.ok(prompt.endsWith('<start_of_turn>model\n'))
    assert.equal(validateTranslation(' أهلاً، كيف حالك؟ ', 'Hello, how are you?'), 'أهلاً، كيف حالك؟')
    for (const text of ['', '<end_of_turn>', '```translation```', null]) assert.throws(() => validateTranslation(text, 'Hello'), /translation/i)
  })
  test('local subtitle schema allows only supported languages and known model choices', () => {
    const request = { source: 'https://youtu.be/fixture', sourceLanguage: 'auto', targetLanguage: 'ar', speechModel: 'accurate', translationModel: 'standard' }
    validateSubtitleRequest(request)
    assert.ok(SUBTITLE_LANGUAGES.ar)
    validateSubtitleRequest({ ...request, recognitionMode: 'music' })
    validateSubtitleRequest({ ...request, compute: 'cpu' })
    for (const change of [{ source: '' }, { source: 'path\0.exe' }, { targetLanguage: '../ar' }, { speechModel: 'untrusted' }, { translationModel: 'cloud' }, { recognitionMode: 'unknown' }, { compute: 'untrusted' }]) assert.throws(() => validateSubtitleRequest({ ...request, ...change }), /Invalid/)
    for (const asset of Object.values(SUBTITLE_ASSETS)) {
      assert.match(asset.sha256, /^[a-f0-9]{64}$/)
      assert.ok(asset.bytes > 0)
      assert.ok(asset.url.startsWith('https://'))
    }
  })
  test('GPU selection rejects unsupported devices and reserves memory for partial translation offload', () => {
    const devices = parseNvidiaDevices('0, NVIDIA GeForce GTX 1050 Ti, 4096, 3000, 6.1\n1, NVIDIA GeForce GTX 1080, 8192, 6000, 6.1')
    assert.equal(devices[0].index, 1)
    for (const row of ['bad', '0, Intel GPU, 4096, 3000, 6.1', '0, NVIDIA GPU, 1024, 900, 6.1', '0, NVIDIA GPU, 4096, 5000, 6.1', '0, NVIDIA GPU, 4096, 3000, 10.0']) assert.deepEqual(parseNvidiaDevices(row), [])
    assert.equal(translationGpuLayers('standard', 500), 0)
    assert.equal(translationGpuLayers('standard', 3000), 31)
    assert.equal(translationGpuLayers('quality', 3000), 15)
    assert.equal(translationGpuLayers('standard', 12000), 34)
    const list = 'Vulkan0: Intel(R) UHD Graphics 630 (8192 MiB)\nVulkan1: NVIDIA GeForce GTX 1050 Ti (4096 MiB)'
    assert.equal(selectVulkanDevice(list, 'NVIDIA GeForce GTX 1050 Ti'), 'Vulkan1')
    assert.equal(selectVulkanDevice(list, 'NVIDIA missing'), null)
  })
  test('local model installation resumes verified ranges and invalidates changed files', () => sandbox(async dir => {
    const bytes = Buffer.from('deterministic local model fixture'), seen = []
    await server(async base => {
      const asset = { id: 'test-model', file: 'test-model.bin', bytes: bytes.length, sha256: digest(bytes), url: base + '/model' }
      SUBTITLE_ASSETS.fixture = asset
      try {
        const assets = new SubtitleAssets(dir)
        await fs.writeFile(path.join(dir, asset.id + '.download.part'), bytes.subarray(0, 8))
        await assets.installAsset(asset, new AbortController().signal, () => {})
        assert.deepEqual(seen, ['bytes=8-'])
        assert.equal(await assets.locate('fixture'), path.join(dir, asset.file))
        await fs.appendFile(path.join(dir, asset.file), 'corruption')
        assert.equal(await assets.locate('fixture'), null)
      } finally { delete SUBTITLE_ASSETS.fixture }
    }, (req, res) => {
      seen.push(req.headers.range)
      res.writeHead(206, { 'Content-Range': `bytes 8-${bytes.length - 1}/${bytes.length}` })
      res.end(bytes.subarray(8))
    })
  }))
  test('local model hash mismatch removes untrusted content and publishes no receipt', () => sandbox(async dir => {
    const bytes = Buffer.from('untrusted download')
    await server(async base => {
      const asset = { id: 'bad-model', file: 'bad.bin', bytes: bytes.length, sha256: 'a'.repeat(64), url: base }
      await assert.rejects(new SubtitleAssets(dir).installAsset(asset, new AbortController().signal, () => {}), /checksum/)
      assert.deepEqual(await fs.readdir(dir), [])
    }, (_req, res) => res.end(bytes))
  }))
  test('local engine archives reject traversal before publishing an executable', () => sandbox(async dir => {
    const AdmZip = require('adm-zip'), zip = new AdmZip()
    zip.addFile('safe/whisper-cli.exe', Buffer.from('fixture'))
    const bytes = zip.toBuffer()
    await server(async base => {

      const entry = zip.getEntries()[0]; entry.header.attr = (0xA1FF << 16) >>> 0
      const unsafe = zip.toBuffer()
      const asset = { id: 'archive', file: 'engine', archive: true, executable: 'whisper-cli.exe', bytes: unsafe.length, sha256: digest(unsafe), url: base }
      await assert.rejects(new SubtitleAssets(dir).installAsset(asset, new AbortController().signal, () => {}), /Unsafe engine archive/)
      await assert.rejects(fs.stat(path.join(dir, 'archive.receipt.json')), /ENOENT/)
      assert.ok(!(await fs.readdir(dir)).some(name => name.startsWith('.install-')))
    }, (_req, res) => { const entry = zip.getEntries()[0]; entry.header.attr = (0xA1FF << 16) >>> 0; res.end(zip.toBuffer()) })
    assert.ok(bytes.length > 0)
  }))
  test('local native process cancellation waits for exit and leaves no child alive', async () => {
    const controller = new AbortController(), processes = new SubtitleProcesses(controller.signal)
    const { child, settled } = processes.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    const rejected = assert.rejects(settled, /Canceled|Abort/)
    controller.abort(); await rejected; await processes.stop()
    assert.notEqual(child.exitCode === null && child.signalCode === null, true)
  })
})

suite('Subtitle lifecycle', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), Module = require('node:module')
  let recognized = 0, stopped = 0, translated = 0, failTranslation = false, holdRecognition = false, activeChild = false
  let outputMode = 'speech', recognitionArgs = [], onRecognized = () => {}, mediaDuration = 11
  let gpuFixture = null, gpuFailure = false, translatorGpuFailure = false, gpuAssets = true, recognitionBinaries = [], translatorConfigs = []
  const gpuHelpers = require('../Back-End/electron/subtitles/gpu.ts')
  const originalLoad = Module._load
  Module._load = function(request, parent, ...rest) {
    if (request === '../paths') return { getBinaryPath: name => name }
    if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
    if (request.endsWith('/engineManager')) return { ensureEnginesReady: async () => {} }
    if (request.endsWith('/ytdlpService')) return { getJsRuntimeArgs: () => [], checkJsRuntime: async () => {} }
    if (request.endsWith('/mediaService')) return { probeMediaFile: async () => ({ format: { duration: String(mediaDuration) }, streams: [{ codec_type: 'audio' }] }) }
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
})

suite('Subtitle media', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), Module = require('node:module')
  const { spawnSync } = require('node:child_process')
  const binary = name => path.resolve('engine-baseline', name + '.exe'), original = Module._load
  Module._load = function(request, parent, ...rest) {
    if (request.endsWith('/engineManager')) return { ensureEnginesReady: async () => {}, engineExecutionFailed() {} }
    if (request.endsWith('/paths')) return { getBinaryPath: binary }
    if (request.endsWith('/ytdlpService')) return { getJsRuntimeArgs: () => [], checkJsRuntime: async () => {} }
    if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
    return original.call(this, request, parent, ...rest)
  }
  const { LocalSubtitleService } = require('../Back-End/electron/subtitles/service.ts')
  const { probeMediaFile } = require('../Back-End/electron/services/mediaService.ts')
  test('local captions embed real Arabic subtitles while preserving video resolution, FPS and encoded audio/video packets', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-ترجمة native-'))
    try {
      const media = path.join(dir, 'original.mp4'), output = path.join(dir, 'with captions.mkv')
      const fixture = spawnSync(binary('ffmpeg'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=576x1024:rate=30000/1001:duration=1',
        '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', media], { windowsHide: true, timeout: 30000 })
      assert.equal(fixture.status, 0, fixture.stderr?.toString())
      const service = new LocalSubtitleService({})
      const cues = [{ id: 1, start: .23, end: .9, text: 'ترجمة عربية بتوقيت الصوت', original: 'Original speech', review: false }]
      service.state = { id: 'fixture', stage: 'ready', progress: 100, document: { id: 'fixture', name: 'original', localFile: media, duration: 1, sourceLanguage: 'en', targetLanguage: 'ar', cues } }
      assert.throws(() => service.embedDocument('fixture', cues, media), /new MKV/)
      service.embedDocument('fixture', cues, output)
      for (let n = 0; service.busy; n++) { if (n > 3000) throw Error('Media embedding stalled'); await new Promise(r => setTimeout(r, 10)) }
      assert.equal(service.state.stage, 'ready', service.state.error)
      const probe = await probeMediaFile(output)
      assert.equal(probe.streams[0].width, 576); assert.equal(probe.streams[0].height, 1024)
      assert.equal(probe.streams[0].avg_frame_rate, '30000/1001')
      assert.ok(probe.streams.some(s => s.codec_type === 'subtitle' && s.tags?.language === 'ara'))
      const packets = file => {
        const result = spawnSync(binary('ffmpeg'), ['-v', 'error', '-i', file, '-map', '0:v', '-map', '0:a', '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-'], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
        assert.equal(result.status, 0, result.stderr)
        return result.stdout.split(/\r?\n/).filter(s => /^\d+,/.test(s)).join('\n')
      }
      assert.equal(packets(output), packets(media))
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })
})

suite('Model readiness', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { spawn } = require('node:child_process')

  test('subtitle Generate enables after delayed readiness IPC, and refreshes existing models on focus and tab return', { timeout: 30000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-subtitle-readiness-'))
    try {
      require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'fixtures/subtitleReadiness.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"' } })
      await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
      await fs.writeFile(path.join(directory, 'electron.cjs'), `
        const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),path=require('node:path');
        app.setPath('userData',path.join(__dirname,'profile'));
        const delay=ms=>new Promise(r=>setTimeout(r,ms));
        app.whenReady().then(async()=>{
          const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
          const js=s=>win.webContents.executeJavaScript(s);
          const wait=async(s,label)=>{for(let n=0;n<60;n++){if(await js(s))return;await delay(50)}throw Error(label)};
          await win.loadFile(path.join(__dirname,'index.html'));
          await wait('!!document.querySelector(".ss-setup button") && !document.querySelector(".ss-setup button").disabled','Initial setup readiness');
          await js('document.querySelector(".ss-language-trigger").click()');
          await wait('document.activeElement.matches(".ss-language-search input")','Language search focus missing');
          const languageBounds=await js('(()=>{const menu=document.querySelector(".ss-language-menu").getBoundingClientRect(),list=document.querySelector(".ss-language-list");return {top:menu.top,bottom:menu.bottom,height:menu.height,viewport:innerHeight,scroll:list.scrollHeight>list.clientHeight}})()');
          assert.ok(languageBounds.top>=0 && languageBounds.bottom<=languageBounds.viewport && languageBounds.height<=272,JSON.stringify(languageBounds));
          assert.equal(languageBounds.scroll,true,'Long language list must scroll inside the menu');
          await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true,cancelable:true}))');
          await wait('document.querySelector(".ss-language-option[data-value=uk]").getAttribute("data-highlighted") === "true"','Keyboard navigation to last language failed');
          assert.equal(await js('(()=>{const o=document.querySelector(".ss-language-option[data-value=uk]").getBoundingClientRect(),l=document.querySelector(".ss-language-list").getBoundingClientRect();return o.top>=l.top && o.bottom<=l.bottom+1})()'),true,'Keyboard option must scroll into view');
          await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
          await wait('!document.querySelector(".ss-language-menu")','Language selection did not dismiss menu');
          assert.match(await js('document.querySelector(".ss-language-trigger").textContent'),/Ukrainian/);
          await js('document.querySelector(".ss-language-trigger").click()');await wait('document.activeElement.matches(".ss-language-search input")','Search reopen');
          await js("{const el=document.querySelector('.ss-language-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'English');el.dispatchEvent(new Event('input',{bubbles:true}))}");
          await wait('document.querySelectorAll(".ss-language-option").length===1','Language search did not filter');
          await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
          await wait('!document.querySelector(".ss-language-menu")','Search selection remained open');
          await js('document.querySelectorAll(".ss-language-trigger")[1].click()');await wait('!!document.querySelector(".ss-language-menu")','Subtitle language menu missing');
          await js('document.querySelector(".ss-language-option[data-value=ar]").click()');
          await wait('!document.querySelector(".ss-language-menu")','Subtitle language selection did not close');
          assert.equal(await js('document.querySelector(".ss-primary").disabled'),true);
          await js('document.querySelector(".ss-setup button").click()');
          await wait('!!document.querySelector(".ss-operation")','Installation started');
          await js('window.fixture.complete()');
          await wait('!document.querySelector(".ss-primary").disabled','Generate remained disabled after delayed IPC');
          assert.equal(await js('!!document.querySelector(".ss-setup")'),false);
          await js('window.fixture.models(false);window.dispatchEvent(new Event("focus"))');
          await wait('document.querySelector(".ss-primary").disabled','Focus did not invalidate missing models');
          await js('window.fixture.models(true);window.dispatchEvent(new Event("focus"))');
          await wait('!document.querySelector(".ss-primary").disabled','Focus did not discover existing models');
          await js('window.fixture.tab("downloads")');await delay(150);
          await js('window.fixture.models(false);window.fixture.tab("subtitles")');
          await wait('document.querySelector(".ss-primary").disabled','Tab return did not refresh readiness');
          await js('window.fixture.tab("downloads")');await delay(150);
          await js('window.fixture.models(true);window.fixture.tab("subtitles")');
          await wait('!document.querySelector(".ss-primary").disabled','Tab return did not discover existing models');
          assert.equal(await js('window.fixture.installs()'),1,'Existing models must not require another download');
          await js("{const el=document.querySelector('.ss-content-options select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'music');el.dispatchEvent(new Event('change',{bubbles:true}))}");
          await wait("document.querySelector('.ss-content-options p')?.textContent.includes('full audio')",'Singing hint missing');
          await js('document.querySelector(".ss-primary").click()');
          await wait('!!window.fixture.request()','Subtitle request missing');
          assert.equal(await js('window.fixture.request().recognitionMode'),'music');
          assert.equal(await js('window.fixture.request().sourceLanguage'),'en');
          assert.equal(await js('window.fixture.request().targetLanguage'),'ar');
          assert.equal(await js('Array.from(document.querySelectorAll(".ss-language-trigger")).every(button=>button.disabled)'),true,'Languages must remain locked during processing');
          await js('window.fixture.noSpeech()');
          await wait("document.querySelector('.ss-error')?.textContent.includes('No recognizable words')",'No-speech explanation missing');
          assert.equal(await js('!!document.querySelector(".ss-review")'),false,'Non-verbal output must not offer a completed translation');
          await js('window.fixture.language("ar")');
          await wait("document.querySelector('.ss-error')?.textContent.includes('لم تُكتشف كلمات')",'Arabic no-speech explanation missing');
          await js('document.querySelector(".ss-primary").click()');
          await wait('!!document.querySelector(".ss-operation")','Timing retry operation did not start');
          await js('window.fixture.retryTiming()');
          await wait("document.querySelector('.ss-operation')?.textContent.includes('تعذّر ضبط توقيت الكلام')",'Arabic timing retry explanation missing');
          await js('window.fixture.invalidTiming()');
          await wait("document.querySelector('.ss-error')?.textContent.includes('توقيتًا غير صالح')",'Arabic timing failure explanation missing');
          await js('window.fixture.language("en")');
          await wait("document.querySelector('.ss-error')?.textContent.includes('invalid caption timing')",'English timing failure explanation missing');
          await js('window.fixture.language("ar")');
          await js('window.fixture.gpu()');
          await wait('!!document.querySelector(".ss-gpu-setup")','GPU preparation should be offered for existing CPU models');
          await js("document.querySelector('.ss-compute-options input[value=cpu]').click()");
          await wait('!document.querySelector(".ss-gpu-setup")','CPU mode must not request GPU downloads');
          assert.equal(await js('document.querySelector(".ss-device-status strong").textContent'),'CPU · Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz');
          await js('document.querySelector(".ss-primary").click()');
          await wait('window.fixture.request().compute === "cpu"','CPU selection was not sent');
          await wait("document.querySelector('.ss-active-device')?.textContent.includes('CPU')",'Actual CPU backend missing');
          assert.match(await js('document.querySelector(".ss-active-device").textContent'),/i7-8700/);
          await js('window.fixture.noSpeech()');await wait('!document.querySelector(".ss-operation")','CPU operation did not finish');
          await js("document.querySelector('.ss-compute-options input[value=auto]').click()");
          await wait('!!document.querySelector(".ss-gpu-setup")','Automatic mode must offer GPU engines');
          await js('document.querySelector(".ss-gpu-setup button").click()');
          await wait('!!document.querySelector(".ss-operation")','GPU installation did not start');
          await js('window.fixture.complete()');
          await wait('!document.querySelector(".ss-primary").disabled && !document.querySelector(".ss-gpu-setup")','GPU readiness did not refresh');
          assert.match(await js('document.querySelector(".ss-compute-options").textContent'),/GPU · NVIDIA GeForce GTX 1050 Ti/);
          await js('document.querySelector(".ss-primary").click()');
          await wait("document.querySelector('.ss-active-device')?.textContent.includes('GPU · NVIDIA')",'Actual GPU backend missing');
          assert.equal(await js('document.querySelector(".ss-clear").disabled'),true,'Clear must not erase a running job');
          await js('window.fixture.done()');
          await wait('!!document.querySelector(".ss-review")','Review result missing');
          assert.match(await js('document.querySelector(".ss-clear").textContent'),/مسح جلسة الترجمة/);
          await js('document.querySelector(".ss-clear").click()');
          await wait('!document.querySelector(".ss-review") && !document.querySelector(".ss-clear")','Cleared result remained visible');
          assert.deepEqual(await js('window.fixture.cleared()'),{count:1,state:{id:'',stage:'idle',progress:null},source:'',preview:null});
          assert.equal(await js('document.querySelector(".ss-primary").disabled'),true,'Cleared source must not be regenerated accidentally');
          win.destroy();app.quit();
        }).catch(e=>{console.error(e);app.exit(1)});
      `)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
        const timer = setTimeout(() => { child.kill(); reject(new Error('Renderer readiness test timed out: ' + output)) }, 25000)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
      })
      assert.equal(result.code, 0, result.output)
    } finally { if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cortex-subtitle-readiness-')) await fs.rm(directory, { recursive: true, force: true }) }
  })
})

suite('Subtitle menu', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { spawn } = require('node:child_process')

  test('subtitle menu names languages, selects/off, dismisses safely and supports keyboard without player shortcuts', { timeout: 30000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-subtitle-menu-'))
    try {
      require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'fixtures/subtitleMenu.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"' } })
      await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="renderer.css"></head><body style="margin:0"><div id="root"></div><script src="renderer.js"></script></body></html>')
      await fs.writeFile(path.join(directory, 'electron.cjs'), `
        const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),path=require('node:path');
        app.disableHardwareAcceleration();
        app.setPath('userData',path.join(__dirname,'profile'));
        const delay=ms=>new Promise(r=>setTimeout(r,ms));
        app.whenReady().then(async()=>{
          const win=new BrowserWindow({show:false,width:900,height:600,webPreferences:{offscreen:true,backgroundThrottling:false}});
          const js=s=>win.webContents.executeJavaScript(s);
          const wait=async(s,label)=>{for(let n=0;n<60;n++){if(await js(s))return;await delay(30)}throw Error(label)};
          const key=async name=>{await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:'+JSON.stringify(name)+',bubbles:true,cancelable:true}))');await delay(40)};
          await win.loadFile(path.join(__dirname,'index.html'));
          await wait('!!document.querySelector(".subtitle-trigger")','Trigger missing');
          assert.match(await js('document.querySelector(".subtitle-current").textContent'),/Arabic/);
          assert.equal(await js('!!document.querySelector("select")'),false);
          await js('document.querySelector(".subtitle-trigger").click()');
          await wait('!!document.querySelector(".subtitle-menu")','Menu missing');
          assert.equal(await js('document.activeElement.getAttribute("aria-checked")'),'true');
          if(process.env.CORTEX_SUBTITLE_MENU_CAPTURE){await delay(250);require('node:fs').writeFileSync(path.join(process.env.CORTEX_SUBTITLE_MENU_CAPTURE,'subtitle-menu-wide.png'),(await win.webContents.capturePage()).toPNG());}
          assert.deepEqual(await js('window.fixture.result().changes'),[],'Opening must not switch subtitles off');
          await key('ArrowDown');await key('Enter');
          await wait('!document.querySelector(".subtitle-menu")','Selection did not close menu');
          assert.deepEqual(await js('window.fixture.result().changes'),[1]);
          assert.equal(await js('document.activeElement.classList.contains("subtitle-trigger")'),true);
          await js('document.querySelector(".subtitle-trigger").click()');await wait('!!document.querySelector(".subtitle-menu")','Reopen');
          await key('Escape');
          assert.equal(await js('!!document.querySelector(".subtitle-menu")'),false);
          assert.equal(await js('window.fixture.result().escapes'),0,'Escape must not close the player');
          await js('document.querySelector(".subtitle-trigger").click()');await wait('!!document.querySelector(".subtitle-menu")','Reopen for outside');
          await js('document.querySelector("#outside").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
          await wait('!document.querySelector(".subtitle-menu")','Outside click did not close menu');
          await js('document.querySelector(".subtitle-trigger").click()');await wait('!!document.querySelector(".subtitle-menu")','Reopen for off');
          await key('Home');await key(' ');
          await wait('document.querySelector(".subtitle-current").textContent === "Off"','Off missing');
          assert.deepEqual(await js('window.fixture.result().changes'),[1,-1]);
          await js('window.fixture.language("ar");document.querySelector(".subtitle-trigger").click()');
          await wait('document.querySelector(".subtitle-menu")?.getAttribute("dir") === "rtl"','Arabic menu missing');
          await wait('document.activeElement.getAttribute("role") === "menuitemradio"','Arabic menu focus missing');
          assert.match(await js('document.querySelectorAll(".subtitle-option")[1].textContent'),/العربية/);
          assert.match(await js('document.querySelectorAll(".subtitle-option")[3].textContent'),/Custom commentary/);
          win.setSize(430,700);await delay(100);
          const bounds=await js('(()=>{const r=document.querySelector(".subtitle-menu").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:innerWidth,scroll:document.documentElement.scrollWidth}})()');
          assert.ok(bounds.left>=0 && bounds.right<=bounds.width && bounds.top>=0,JSON.stringify(bounds));
          assert.equal(bounds.scroll,bounds.width,'Controls overflow at narrow width');
          if(process.env.CORTEX_SUBTITLE_MENU_CAPTURE){await delay(250);require('node:fs').writeFileSync(path.join(process.env.CORTEX_SUBTITLE_MENU_CAPTURE,'subtitle-menu-ar-narrow.png'),(await win.webContents.capturePage()).toPNG());}
          // An offscreen document has no native focus; emit the focus event generated by Tab in a visible window.
          await js('document.querySelector("#outside").focus();document.querySelector("#outside").dispatchEvent(new FocusEvent("focusin",{bubbles:true}))');
          await wait('!document.querySelector(".subtitle-menu")','Tabbing out must dismiss menu');
          assert.equal(await js('window.fixture.result().plays'),0,'Menu keys must not toggle playback');
          win.destroy();app.quit();
        }).catch(e=>{console.error(e);app.exit(1)});
      `)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
        const timer = setTimeout(() => { child.kill(); reject(new Error('Subtitle menu test timed out: ' + output)) }, 25000)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
      })
      assert.equal(result.code, 0, result.output)
    } finally { if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cortex-subtitle-menu-')) await fs.rm(directory, { recursive: true, force: true }) }
  })
})

suite('Subtitle merge', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), Module = require('node:module')
  const { spawnSync } = require('node:child_process')
  const binary = name => path.resolve('engine-baseline', name + '.exe'), original = Module._load
  let ensure = async () => {}
  const handlers = new Map(), sender = new (require('node:events').EventEmitter)()
  let dialogResult = { canceled: true }, task
  Module._load = function(request, parent, ...rest) {
    if (request.endsWith('/engineManager')) return { ensureEnginesReady: (...args) => ensure(...args), engineExecutionFailed() {} }
    if (request.endsWith('/paths')) return { getBinaryPath: binary }
    if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
    if (request === 'electron') return { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: { showSaveDialog: async () => dialogResult } }
    return original.call(this, request, parent, ...rest)
  }
  const { listDownloadSubtitles, mergeDownloadSubtitle } = require('../Back-End/electron/subtitles/downloadMerge.ts')
  const { registerDownloadSubtitleIpc } = require('../Back-End/electron/subtitles/downloadMergeIpc.ts')
  const { validateIpcArguments } = require('../Back-End/electron/ipcSecurity.ts')
  const { probeMediaFile } = require('../Back-End/electron/services/mediaService.ts')
  const srt = '1\n00:00:00,200 --> 00:00:00,900\nترجمة عربية بتوقيت الصوت\n'
  async function sandbox(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-merge-'))
    try { await fn(dir) } finally { ensure = async () => {}; await fs.rm(dir, { recursive: true, force: true }) }
  }
  function ffmpeg(args) {
    const result = spawnSync(binary('ffmpeg'), ['-v', 'error', ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    assert.equal(result.status, 0, result.stderr); return result.stdout
  }
  test('sidecar discovery accepts matching timed SRT/VTT, with language, while ignoring unrelated and invalid files', () => sandbox(async dir => {
    const name = 'فيديو with spaces', media = path.join(dir, name + '.mp4')
    for (const [suffix, text] of [['.ar.srt', srt], ['.en.vtt', 'WEBVTT\n\n00:00.200 --> 00:00.900\nHello'], ['.srt', srt], ['.fr.srt', 'invalid'], ['.de.srt', ''], ['other.ar.srt', srt]]) await fs.writeFile(path.join(dir, suffix.startsWith('.') ? name + suffix : suffix), text)
    const found = await listDownloadSubtitles(media)
    assert.equal(found.length, 3); assert.equal(found.find(f => f.language === 'ar').label, 'Arabic'); assert.ok(found.some(f => f.language === 'und'))
    await assert.rejects(mergeDownloadSubtitle(media, '../other.ar.srt', path.join(dir, 'out.mp4'), 'mp4', new AbortController().signal), /SUBTITLE_FILE_UNAVAILABLE/)
  }))
  test('real MP4 and MKV contain timed Arabic with unchanged audio/video packets, codecs, FPS and resolution', () => sandbox(async dir => {
    const media = path.join(dir, 'original.mp4'), caption = 'original.ar.srt'
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30000/1001:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', media])
    await fs.writeFile(path.join(dir, caption), srt)
    const packets = file => ffmpeg(['-i', file, '-map', '0:v', '-map', '0:a', '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-']).split(/\r?\n/).filter(s => /^\d+,/.test(s)).join('\n')
    for (const format of ['mp4', 'mkv']) {
      const output = path.join(dir, 'out.' + format)
      await mergeDownloadSubtitle(media, caption, output, format, new AbortController().signal)
      const probe = await probeMediaFile(output), video = probe.streams.find(s => s.codec_type === 'video'), subtitle = probe.streams.find(s => s.codec_type === 'subtitle')
      assert.equal(video.width, 320); assert.equal(video.height, 180); assert.equal(video.avg_frame_rate, '30000/1001')
      assert.equal(subtitle.tags.language, 'ara'); assert.equal(subtitle.codec_name, format === 'mp4' ? 'mov_text' : 'subrip')
      assert.equal(packets(output), packets(media))
      const extracted = ffmpeg(['-i', output, '-map', '0:s:0', '-f', 'srt', '-'])
      assert.match(extracted, /ترجمة عربية بتوقيت الصوت/); assert.match(extracted, /00:00:00,200 --> 00:00:00,900/)
    }
    const english = path.join(dir, 'english.srt'), withEnglish = path.join(dir, 'bilingual.mp4')
    await fs.writeFile(english, '1\n00:00:00,200 --> 00:00:00,900\nOriginal English\n')
    ffmpeg(['-i', media, '-i', english, '-map', '0:v', '-map', '0:a', '-map', '1:s', '-c', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', withEnglish])
    await fs.writeFile(path.join(dir, 'bilingual.ar.srt'), srt)
    await mergeDownloadSubtitle(withEnglish, 'bilingual.ar.srt', path.join(dir, 'bilingual-out.mp4'), 'mp4', new AbortController().signal)
    assert.deepEqual((await probeMediaFile(path.join(dir, 'bilingual-out.mp4'))).streams.filter(s => s.codec_type === 'subtitle').map(s => s.tags.language), ['eng', 'ara'])
    await assert.rejects(mergeDownloadSubtitle(media, caption, media, 'mp4', new AbortController().signal), /CHOOSE_NEW/)
    const controller = new AbortController(); ensure = async () => controller.abort()
    const canceled = path.join(dir, 'canceled.mp4')
    await assert.rejects(mergeDownloadSubtitle(media, caption, canceled, 'mp4', controller.signal), /abort/i)
    assert.equal(await fs.stat(canceled).catch(() => null), null)
    assert.equal((await fs.readdir(dir)).some(name => name.startsWith('.cortex-merge-')), false)
  }))
  test('merge IPC requires a completed download and an offered sidecar, validates filenames and handles canceled Save dialog', () => sandbox(async dir => {
    task = { status: 'completed', filePath: path.join(dir, 'video.mp4') }
    await fs.writeFile(path.join(dir, 'video.ar.srt'), srt)
    registerDownloadSubtitleIpc({ getWin: () => ({}), getDownloads: () => ({ get: () => task }) })
    const list = handlers.get('cortexdl:subtitle-files:list'), merge = handlers.get('cortexdl:subtitle-files:merge')
    assert.equal((await list({}, 'task')).length, 1)
    task.status = 'downloading'; await assert.rejects(list({}, 'task'), /SELECT_COMPLETED/); task.status = 'completed'
    await assert.rejects(merge({ sender }, 'task', 'unrelated.srt', 'mp4'), /UNAVAILABLE/)
    assert.equal(await merge({ sender }, 'task', 'video.ar.srt', 'mp4'), null)
    assert.equal(sender.listenerCount('destroyed'), 0)
    for (const args of [['task', '../x.srt', 'mp4'], ['task', 'x.exe', 'mp4'], ['task', 'x.srt', 'avi'], ['task', 'x.srt']]) assert.throws(() => validateIpcArguments('cortexdl:subtitle-files:merge', args))
    validateIpcArguments('cortexdl:subtitle-files:merge', ['task', 'video.ar.srt', 'mp4'])
  }))
})

suite('Merge interface', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { spawn } = require('node:child_process')
  test('download merge button discovers sidecars, selects language/MP4, cancels and opens the saved video, with responsive Arabic layout', { timeout: 35000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-merge-ui-'))
    try {
      require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'fixtures/downloadSubtitleMerge.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"' } })
      await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>body{margin:0;padding:20px;background:#0d1829;color:#e4edf8;font-family:Arial}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
      await fs.writeFile(path.join(directory, 'electron.cjs'), `
        const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
        app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
        const delay=ms=>new Promise(r=>setTimeout(r,ms));
        app.whenReady().then(async()=>{
          const win=new BrowserWindow({show:false,width:850,height:740,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}}),js=s=>win.webContents.executeJavaScript(s);
          const wait=async s=>{for(let n=0;n<60;n++){if(await js(s))return;await delay(50)}throw Error('UI did not settle: '+s)};
          const capture=async name=>{if(process.env.CORTEX_MERGE_CAPTURE){await delay(180);fs.writeFileSync(path.join(process.env.CORTEX_MERGE_CAPTURE,name+'.png'),(await win.webContents.capturePage()).toPNG())}};
          await win.loadFile(path.join(__dirname,'index.html'));await wait('!!document.querySelector(".dc-card")');await delay(100);
          assert.equal(await js('!!document.querySelector(".dc-merge")'),false,'Must hide without subtitles');
          await js('window.fixture.tracks()');await wait('!!document.querySelector(".dc-merge")');await capture('merge-card');
          await js('document.querySelector(".dc-merge").click()');await wait('!!document.querySelector(".dsm-dialog")');
          assert.equal(await js('document.querySelectorAll(".dsm-file").length'),2);
          assert.match(await js('document.querySelector(".dsm-formats input:checked").parentElement.textContent'),/MP4/);
          await capture('merge-en');
          await js('document.querySelectorAll(".dsm-file input")[1].click();document.querySelector(".dsm-save").click()');await wait('!!document.querySelector(".dsm-busy")');
          assert.deepEqual(await js('window.fixture.request()'),['fixture','Nightcore_-_If_U_Seek_Amy_-_(Lyrics).en.vtt','mp4']);
          assert.equal(await js('document.querySelector(".dsm-files").disabled'),true);
          await js('document.querySelector(".dsm-footer button").click()');await wait('!!document.querySelector(".dsm-save")');
          assert.equal(await js('window.fixture.result().canceled'),1);
          await js('document.querySelectorAll(".dsm-file input")[0].click();document.querySelector(".dsm-save").click()');await wait('!!document.querySelector(".dsm-busy")');
          await js('window.fixture.finish()');await wait('!!document.querySelector(".dsm-success")');
          await js('document.querySelector(".dsm-play").click()');await wait('!document.querySelector(".dsm-dialog")');
          assert.equal(await js('window.fixture.result().opened'),'C:/fixture/video.subtitled.mp4');
          await js('window.fixture.language("ar");document.querySelector(".dc-merge").click()');await wait('document.querySelector(".dsm-dialog")?.getAttribute("dir")==="rtl"');
          await capture('merge-ar');win.setContentSize(430,700);await delay(150);await capture('merge-ar-narrow');
          const bounds=await js('(()=>{const r=document.querySelector(".dsm-dialog").getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,top:r.top,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth}})()');
          assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height,JSON.stringify(bounds));
          assert.equal(bounds.scroll,bounds.width,'Narrow Arabic must not overflow');
          await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');await wait('!document.querySelector(".dsm-dialog")');
          await js('window.fixture.noTracks()');await wait('!document.querySelector(".dc-merge")');
          win.destroy();app.quit();
        }).catch(e=>{console.error(e);app.exit(1)});
      `)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
        const timer = setTimeout(() => { child.kill(); reject(new Error('Merge UI timed out: ' + output)) }, 30000)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
      })
      assert.equal(result.code, 0, result.output)
    } finally { if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cortex-merge-ui-')) await fs.rm(directory, { recursive: true, force: true }) }
  })
})
