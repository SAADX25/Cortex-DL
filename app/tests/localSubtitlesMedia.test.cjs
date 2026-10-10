require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), Module = require('node:module')
const { spawnSync } = require('node:child_process')
const binary = name => path.resolve('engine-baseline', name + '.exe'), original = Module._load
Module._load = function(request, parent, ...rest) {
  if (request.endsWith('/engineReadiness')) return { ensureEnginesReady: async () => {}, engineExecutionFailed() {} }
  if (request.endsWith('/paths')) return { getBinaryPath: binary }
  if (request.endsWith('/ytdlp')) return { getJsRuntimeArgs: () => [], checkJsRuntime: async () => {} }
  if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
  return original.call(this, request, parent, ...rest)
}
const { LocalSubtitleService } = require('../Back-End/electron/subtitles/service.ts')
const { probeMediaFile } = require('../Back-End/electron/mediaFiles.ts')
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
