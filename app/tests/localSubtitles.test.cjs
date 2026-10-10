require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { createHash } = require('node:crypto')
const { SUBTITLE_LANGUAGES, validateSubtitleRequest } = require('../Shared/localSubtitles.ts')
const { parseWhisperDocument, serializeSubtitles, validateCues } = require('../Shared/subtitleCues.ts')
const { translationPrompt, validateTranslation } = require('../Back-End/electron/subtitles/translator.ts')
const { SubtitleAssets } = require('../Back-End/electron/subtitles/assets.ts')
const { SUBTITLE_ASSETS } = require('../Back-End/electron/subtitles/manifest.ts')
const { SubtitleProcesses } = require('../Back-End/electron/subtitles/process.ts')
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
  for (const change of [{ source: '' }, { source: 'path\0.exe' }, { targetLanguage: '../ar' }, { speechModel: 'untrusted' }, { translationModel: 'cloud' }]) assert.throws(() => validateSubtitleRequest({ ...request, ...change }), /Invalid/)
  for (const asset of Object.values(SUBTITLE_ASSETS)) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/)
    assert.ok(asset.bytes > 0)
    assert.ok(asset.url.startsWith('https://'))
  }
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
    // Use a symlink mode; the archive extractor must reject non-regular entries.
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
