const { suite } = require('./register-ts.cjs')

suite('Audit hardening: security, reliability, and store invariants', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const http = require('node:http')
  const Module = require('node:module')
  const { EventEmitter } = require('node:events')

  const originalLoad = Module._load
  const loggerStub = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    transports: { file: { maxSize: 0, level: 'info' } },
    hooks: [],
  }
  const dbStub = {
    prepare: () => ({
      get: () => ({ value: '2' }),
      run: () => ({}),
      all: () => [],
    }),
  }

  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getVersion: () => '2.4.0',
          getPath: () => os.tmpdir(),
          isPackaged: false,
          exit() {},
          quit() {},
        },
        dialog: {},
        ipcMain: { handle() {}, on() {} },
        shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {} },
        safeStorage: { isEncryptionAvailable: () => false },
      }
    }
    if (request === 'electron-log') return loggerStub
    if (request === '../db' || request === './db') return { db: dbStub, taskDb: {} }
    return originalLoad.call(this, request, parent, isMain)
  }

  const { validateIpcArguments } = require('../Back-End/electron/ipcSecurity.ts')
  const { validateDownloadInput } = require('../Back-End/electron/ipc/handlers.ts')
  const { DirectEngine } = require('../Back-End/electron/engines/DirectEngine.ts')
  const { createAppUpdateController } = require('../Back-End/electron/services/updateService.ts')
  const { redact } = require('../Back-End/electron/diagnostics.ts')
  const { decodeXmlEntities } = require('../Back-End/electron/services/threadsManifest.ts')

  test('ipcSecurity blocks UNC paths, malformed sessions, and wrong arg counts', () => {
    for (const channel of [
      'cortexdl:open-folder',
      'cortexdl:open-file',
      'cortexdl:get-media-fps',
      'cortexdl:get-subtitles',
    ]) {
      assert.throws(() => validateIpcArguments(channel, ['\\\\evil\\share\\video.mp4', 'sess-1']))
      assert.throws(() => validateIpcArguments(channel, ['//evil/share/video.mp4', 'sess-1']))
    }
    assert.throws(() => validateIpcArguments('cortexdl:library:add', [['\\\\evil\\share\\a.mp4']]))
    assert.throws(() => validateIpcArguments('cortexdl:get-media-fps', ['C:\\a.mp4', '../bad']))
    assert.throws(() => validateIpcArguments('cortexdl:get-subtitles', ['C:\\a.mp4']))
    assert.throws(() => validateIpcArguments('cortexdl:close-media-session', ['bad/session']))
    assert.throws(() =>
      validateIpcArguments('cortexdl:get-trim-preview-streams', [
        'https://example.com/v.mp4',
        'not-trim-prefix',
      ]),
    )
    assert.throws(() => validateIpcArguments('cortexdl:secure-save', ['only-one']))
    assert.throws(() => validateIpcArguments('cortexdl:secure-get', ['a', 'extra']))
    assert.throws(() =>
      validateIpcArguments('cortexdl:analyze-url', ['https://example.com/v', 123]),
    )
    assert.doesNotThrow(() =>
      validateIpcArguments('cortexdl:get-trim-preview-streams', [
        'https://example.com/v.mp4',
        'trim-abc-123',
      ]),
    )
  })

  test('validateDownloadInput blocks traversal formats, bad subfolders, and UNC directories', () => {
    const valid = {
      url: 'https://example.com/video.mp4',
      directory: path.join(os.tmpdir(), 'downloads'),
      filename: 'clip.mp4',
      subfolderName: 'Clips',
      targetFormat: 'mp4',
      engine: 'auto',
      trimMode: 'fast',
    }
    assert.doesNotThrow(() => validateDownloadInput(valid))
    assert.throws(
      () => validateDownloadInput({ ...valid, targetFormat: '../../evil.bat' }),
      /Invalid target format/,
    )
    assert.throws(
      () => validateDownloadInput({ ...valid, subfolderName: '..' }),
      /Invalid subfolder name/,
    )
    assert.throws(
      () => validateDownloadInput({ ...valid, directory: '\\\\evil\\share' }),
      /Invalid download directory/,
    )
    assert.throws(
      () => validateDownloadInput({ ...valid, engine: 'shell' }),
      /Invalid download engine/,
    )
    assert.throws(
      () => validateDownloadInput({ ...valid, trimMode: 'arbitrary' }),
      /Invalid trim mode/,
    )
  })

  test('DirectEngine returns retryable-error instead of paused when a chunk fails', async () => {
    const size = 6 * 1024 * 1024
    const server = http.createServer((req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
          ETag: '"v1"',
        })
        res.end()
        return
      }
      const range = String(req.headers.range || '')
      if (range.startsWith('bytes=0-')) {
        const match = /bytes=(\d+)-(\d+)/.exec(range)
        const start = Number(match[1])
        const end = Number(match[2])
        const len = end - start + 1
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(len),
          ETag: '"v1"',
        })
        res.end(Buffer.alloc(len, 0x61))
        return
      }
      res.writeHead(500)
      res.end('chunk failed')
    })

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cortex-direct-chunk-'))
    try {
      const { port } = server.address()
      const filePath = path.join(tmpDir, 'out.bin')
      const engine = new DirectEngine()
      const result = await engine.download({
        id: 'chunk-fail-1',
        url: `http://127.0.0.1:${port}/file.bin`,
        directory: tmpDir,
        filename: 'out.bin',
        filePath,
        engine: 'direct',
        targetFormat: 'mp4',
        status: 'downloading',
        totalBytes: null,
        downloadedBytes: 0,
        speedBytesPerSec: null,
        errorMessage: null,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      })
      assert.equal(result.kind, 'retryable-error')
    } finally {
      server.close()
      await fs.promises.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('DirectEngine resumes single-stream from actual disk size when downloadedBytes is ahead', async () => {
    const payload = Buffer.alloc(4096, 0x42)
    let seenRange = null
    const server = http.createServer((req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Length': String(payload.length),
          'Accept-Ranges': 'bytes',
          ETag: '"single-v1"',
        })
        res.end()
        return
      }
      seenRange = req.headers.range || null
      if (seenRange === 'bytes=1000-') {
        const slice = payload.subarray(1000)
        res.writeHead(206, {
          'Content-Range': `bytes 1000-${payload.length - 1}/${payload.length}`,
          'Content-Length': String(slice.length),
          ETag: '"single-v1"',
        })
        res.end(slice)
        return
      }
      res.writeHead(200, { 'Content-Length': String(payload.length), ETag: '"single-v1"' })
      res.end(payload)
    })

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cortex-direct-resume-'))
    try {
      const { port } = server.address()
      const filePath = path.join(tmpDir, 'part.bin')
      await fs.promises.writeFile(filePath, payload.subarray(0, 1000))
      const engine = new DirectEngine()
      const result = await engine.download({
        id: 'single-resume-1',
        url: `http://127.0.0.1:${port}/part.bin`,
        directory: tmpDir,
        filename: 'part.bin',
        filePath,
        engine: 'direct',
        targetFormat: 'mp4',
        status: 'downloading',
        totalBytes: payload.length,
        downloadedBytes: 1500,
        etag: '"single-v1"',
        supportsRanges: false,
        speedBytesPerSec: null,
        errorMessage: null,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      })
      assert.equal(result.kind, 'success')
      assert.equal(seenRange, 'bytes=1000-')
      assert.deepEqual(await fs.promises.readFile(filePath), payload)
    } finally {
      server.close()
      await fs.promises.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('updateService.dispose removes only its own listeners and keeps external error handlers', async () => {
    class MockUpdater extends EventEmitter {
      async checkForUpdates() {
        this.emit('update-not-available')
        return null
      }
      async downloadUpdate() {
        return []
      }
      quitAndInstall() {}
    }

    const updater = new MockUpdater()
    const externalErrorHandler = () => {}
    updater.on('error', externalErrorHandler)

    const controller = createAppUpdateController({
      currentVersion: '2.4.0',
      isPackaged: () => true,
      loadUpdater: async () => ({
        autoUpdater: updater,
        createCancellationToken: () => ({ cancelled: false, cancel() {} }),
      }),
      emitState() {},
      onBeforeQuitForInstall() {},
      logger: loggerStub,
    })

    await controller.checkForUpdates(true)
    assert.equal(updater.listenerCount('error'), 2)
    controller.dispose()
    assert.equal(updater.listenerCount('error'), 1)
    assert.equal(updater.listenerCount('checking-for-update'), 0)
    assert.equal(updater.listeners('error')[0], externalErrorHandler)
  })

  test('diagnostics.redact scrubs token values without corrupting error codes', () => {
    assert.equal(redact('token=secret123'), '[secret redacted]')
    assert.equal(redact('Bearer super.secret.jwt'), '[secret redacted]')
    assert.equal(redact('error: youtube_po_token_required'), 'error: youtube_po_token_required')
  })

  test('threadsManifest.decodeXmlEntities bounds code points and avoids double unescaping', () => {
    assert.equal(decodeXmlEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;')
    assert.equal(decodeXmlEntities('&#99999999;&#x110000;'), '&#99999999;&#x110000;')
    assert.equal(decodeXmlEntities('&#65;&#x42;&apos;&quot;'), 'AB\'"')
  })

  test('downloadStore active count includes merging tasks', () => {
    const {
      useDownloadStore,
      getActiveDownloadCount,
    } = require('../Front-End/src/stores/downloadStore.ts')
    useDownloadStore.getState().loadTasks([
      { id: '1', status: 'merging' },
      { id: '2', status: 'downloading' },
      { id: '3', status: 'completed' },
    ])
    assert.equal(getActiveDownloadCount(), 2)
  })
})
