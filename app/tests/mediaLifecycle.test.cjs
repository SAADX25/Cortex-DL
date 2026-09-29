const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const { Transform } = require('node:stream')
const { MediaRequestRegistry } = require('../Back-End/electron/mediaRequestRegistry.ts')
const { releaseMediaElement, clearMediaCanvas, releaseAudioGraph, stopPlayerFrame } = require('../Front-End/src/components/MediaPlayer/mediaSession.ts')

test('video and audio elements release their sources and canvas buffers across 20 sessions each', () => {
  for (const kind of ['video', 'audio']) {
    for (let i = 0; i < 20; i++) {
      const calls = []
      const sources = [{ removeAttribute: name => calls.push(`track:${name}`) }]
      const element = {
        currentTime: 40,
        pause: () => calls.push('pause'),
        removeAttribute: name => calls.push(`media:${name}`),
        querySelectorAll: () => sources,
        load: () => calls.push('load'),
      }
      const canvas = {
        width: 160,
        height: 90,
        getContext: () => ({ clearRect: () => calls.push('clear') }),
      }
      releaseMediaElement(element)
      clearMediaCanvas(canvas)
      assert.equal(element.currentTime, 0, kind)
      assert.deepEqual(calls, ['pause', 'media:src', 'track:src', 'load', 'clear'])
      assert.equal(canvas.width, 0)
      assert.equal(canvas.height, 0)
    }
  }
})

test('20 audio sessions close their graphs and stop visualizer and ambilight frames', async () => {
  for (let i = 0; i < 20; i++) {
    const canceled = []
    const calls = []
    const analyser = { disconnect: () => calls.push('analyser') }
    const source = { disconnect: node => { assert.equal(node, analyser); calls.push('source') } }
    const context = { close: async () => { calls.push('close') } }
    stopPlayerFrame(i + 1, id => canceled.push(id))
    stopPlayerFrame(i + 100, id => canceled.push(id))
    await releaseAudioGraph(context, source, analyser)
    assert.deepEqual(canceled, [i + 1, i + 100])
    assert.deepEqual(calls, ['source', 'analyser', 'close'])
  }
})

test('closing a player session stops its active file stream and subtitle process', async () => {
  const registry = new MediaRequestRegistry()
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-media-session-'))
  const fixture = path.join(directory, 'fixture.mp4')
  await fs.writeFile(fixture, Buffer.alloc(1024 * 1024, 7))
  const server = http.createServer((req, res) => {
    const session = req.url.slice(1)
    if (registry.isClosed(session)) { res.writeHead(410); res.end(); return }
    assert.equal(req.headers.range, 'bytes=0-65535')
    res.writeHead(206, { 'Content-Range': 'bytes 0-65535/1048576', 'Content-Length': 65536 })
    const file = createReadStream(fixture, { start: 0, end: 65535, highWaterMark: 1024 })
    const slow = new Transform({ transform(chunk, _encoding, callback) {
      setTimeout(() => callback(null, chunk), 2)
    } })
    let ended = false
    let untrack = () => {}
    const stop = () => {
      if (ended) return
      ended = true
      file.destroy()
      slow.destroy()
      res.destroy()
    }
    res.on('close', stop)
    file.on('close', () => { untrack(); stop() })
    untrack = registry.track(session, 'stream', stop)
    file.pipe(slow).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    for (let i = 0; i < 20; i++) {
      const session = `session-${i}`
      const response = await new Promise((resolve, reject) => {
        const request = http.get(`http://127.0.0.1:${server.address().port}/${session}`, { headers: { Range: 'bytes=0-65535' } }, resolve)
        request.on('error', reject)
      })
      response.pause()
      assert.equal(response.statusCode, 206)
      assert.equal(registry.snapshot().streams, 1)
      let childStopped = 0
      let untrackSubtitle = () => {}
      untrackSubtitle = registry.track(session, 'subtitle', () => { childStopped++; untrackSubtitle() })
      assert.equal(registry.snapshot().ffmpegProcesses, 1)
      let untrackProbe = () => {}
      untrackProbe = registry.track(session, 'probe', () => { childStopped++; untrackProbe() })
      assert.equal(registry.snapshot().probeProcesses, 1)
      await registry.closeSession(session)
      response.destroy()
      assert.equal(registry.snapshot().streams, 0)
      assert.equal(registry.snapshot().ffmpegProcesses, 0)
      assert.equal(registry.snapshot().probeProcesses, 0)
      assert.equal(childStopped, 2)
      assert.equal(registry.isClosed(session), true)
      let lateStopped = 0
      registry.track(session, 'stream', () => { lateStopped++ })
      assert.equal(lateStopped, 1, 'late requests must not restart a closed session')
    }
    await registry.closeAll()
    assert.equal(registry.snapshot().streams, 0)
    assert.equal(registry.isClosed(null), true)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  }
})
