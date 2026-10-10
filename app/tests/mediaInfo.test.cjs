require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Module = require('node:module')
const { parseFrameRate, videoFrameRate } = require('../Shared/frameRate.ts')
let readiness = async () => {}
let probeSpawns = 0
const bin = name => path.resolve('engine-baseline', name + '.exe')
const originalLoad = Module._load
Module._load = function(request, ...args) {
  if (request === './engineReadiness' || request === '../engineReadiness') return { ensureEnginesReady: (...args) => readiness(...args), engineExecutionFailed() {} }
  if (request === './paths' || request === '../paths') return { getBinaryPath: name => { if (name === 'ffprobe') probeSpawns++; return bin(name) } }
  return originalLoad.call(this, request, ...args)
}
const { MediaProcessor } = require('../Back-End/electron/engines/MediaProcessor.ts')

test('media FPS preserves fractional rates and rejects missing or invalid values', () => {
  assert.equal(parseFrameRate('30000/1001'), 30000 / 1001)
  assert.equal(parseFrameRate('60000/1001'), 60000 / 1001)
  assert.equal(parseFrameRate('29.97'), 29.97)
  assert.equal(parseFrameRate(60), 60)
  for (const invalid of [undefined, null, '', 'Unknown', '0/0', '30/0', '0/1', -30, Infinity, '1/2/3', '12junk', true]) assert.equal(parseFrameRate(invalid), null)
})

test('media FPS selects actual video, prefers the average and falls back to the nominal rate', () => {
  const streams = [
    { codec_type: 'audio', avg_frame_rate: '999/1' },
    { codec_type: 'video', disposition: { attached_pic: 1 }, avg_frame_rate: '1/1' },
    { codec_type: 'video', avg_frame_rate: '30000/1001', r_frame_rate: '60/1' },
  ]
  assert.equal(videoFrameRate(streams), 30000 / 1001)
  streams[2].avg_frame_rate = '0/0'
  assert.equal(videoFrameRate(streams), 60)
  assert.equal(videoFrameRate(streams.slice(0, 2)), null)
  assert.equal(videoFrameRate([{ codec_type: 'video', avg_frame_rate: '0/0', r_frame_rate: '0/0' }]), null)
})

test('media FPS probes a real portrait MP4 with a fractional rate and a path containing spaces and Arabic', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-fps العربية-'))
  try {
    const file = path.join(directory, 'portrait video.mp4')
    const result = spawnSync(bin('ffmpeg'), ['-y', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=576x1024:r=30000/1001', '-t', '0.4', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', file], { windowsHide: true, timeout: 15000 })
    assert.equal(result.status, 0, String(result.stderr || result.error))
    const processor = new MediaProcessor()
    assert.equal(await processor.getFps(file), 30000 / 1001)
    processor.killAll()
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('closing a media FPS request during readiness prevents a late native probe', async () => {
  let release
  readiness = () => new Promise(resolve => { release = resolve })
  const processor = new MediaProcessor()
  const before = probeSpawns
  try {
    const pending = processor.getFps('unused.mp4')
    processor.killAll()
    release()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(probeSpawns, before)
  } finally { readiness = async () => {} }
})
