require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const os = require('node:os')
const Module = require('node:module')
const originalLoad = Module._load
const handlers = new Map()
Module._load = function(request, parent, ...rest) {
  if (request === 'electron') return {
    app: { isPackaged: false, getPath: () => os.tmpdir() },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
  }
  if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
  if (request === '../db' || request === './db') return { db: { prepare: () => ({ get: () => undefined }), pragma: () => 'ok' } }
  if (request === '../setup') return { engineHealth: async () => ['ffmpeg', 'ffprobe'].map(name => ({ name, available: true, version: 'fixture' })) }
  if (request === '../ytdlp') return { getYtdlpVersion: async () => 'fixture', checkJsRuntime: async () => ({ available: true }), validateCookieFile: async () => ({ valid: false, code: 'missing' }) }
  if (request === '../diagnostics') return { buildInfo: () => ({}) }
  if (request === '../analysisNetwork') return { fetchBoundedJson: async () => ({}) }
  return originalLoad.call(this, request, parent, ...rest)
}
const { registerIpcHandlers } = require('../Back-End/electron/ipc/handlers.ts')

test('download history loads while engines are pending or unavailable; new downloads wait for engines', async () => {
  const saved = [{ id: 'saved-task', status: 'completed' }]
  let ready, added = 0
  const serviceReadyPromise = new Promise(resolve => { ready = resolve })
  registerIpcHandlers({
    getDownloads: () => ({ list: () => saved, add: async input => { added++; return input }, addBatch: async inputs => { added++; return inputs } }),
    serviceReadyPromise,
  })
  assert.deepEqual(await handlers.get('cortexdl:downloads:list')(), saved)
  const input = { url: 'https://example.com/audio.mp3', directory: os.tmpdir(), engine: 'direct', targetFormat: 'mp3' }
  const single = handlers.get('cortexdl:downloads:add')(null, input)
  const batch = handlers.get('cortexdl:downloads:add-batch')(null, [input])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(added, 0)
  ready()
  await Promise.all([single, batch])
  assert.equal(added, 2)
})

test('missing history manager reports failure instead of silently returning an empty history', async () => {
  registerIpcHandlers({ getDownloads: () => null, serviceReadyPromise: new Promise(() => {}) })
  await assert.rejects(handlers.get('cortexdl:downloads:list')(), /history not initialized/)
})

test('startup health authenticates its media probe and rejects unauthorized responses', async () => {
  const token = 'per-launch+token&value'
  const requests = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    requests.push({ method: req.method, path: url.pathname, token: url.searchParams.get('token') })
    res.writeHead(url.pathname === '/health' && url.searchParams.get('token') === token ? 204 : 401)
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    registerIpcHandlers({ getMediaPort: () => port, getMediaToken: () => token })
    assert.equal((await handlers.get('cortexdl:health-check')()).mediaServer.healthy, true)
    assert.deepEqual(requests[0], { method: 'HEAD', path: '/health', token })
    registerIpcHandlers({ getMediaPort: () => port, getMediaToken: () => 'wrong-token' })
    assert.equal((await handlers.get('cortexdl:health-check')()).mediaServer.healthy, false)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
