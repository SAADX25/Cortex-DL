const { suite } = require('./register-ts.cjs')

suite('Engine receipts', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const crypto = require('node:crypto')
  const Module = require('node:module')
  const { EventEmitter } = require('node:events')
  const load = Module._load
  let launches = 0
  Module._load = function(request, parent, ...args) {
    if (request === 'electron') return { app: { getPath: () => os.tmpdir(), requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}) } }
    if (request === './diagnostics' && parent.filename.endsWith('bootstrap.ts')) return { initializeDiagnostics() {} }
    if (request === 'node:child_process' && parent.filename.endsWith('engineManager.ts')) return {
      execFile(_file, _args, options, callback) {
        launches++
        const child = new EventEmitter()
        setImmediate(() => callback(options.signal?.aborted ? new Error('aborted') : null, '2026.08.19\n'))
        return child
      },
    }
    return load.call(this, request, parent, ...args)
  }
  const { EngineReceipts, readEngineMetadata, verificationMetrics, verifyEngine } = require('../Back-End/electron/engines/engineManager.ts')

  const { afterUiReady } = require('../Back-End/electron/bootstrap.ts')
  const tick = () => new Promise(resolve => setImmediate(resolve))
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
  async function sandbox(work) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-receipts-'))
    const file = path.join(dir, 'yt-dlp.exe'), receipt = file + '.integrity.json'
    const bytes = Buffer.alloc(100000, 42)
    bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(64, 60)
    bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x8664, 68)
    await fs.writeFile(file, bytes)
    let identity = 'manifest-1'
    const spec = { name: 'yt-dlp', filename: 'yt-dlp.exe', version: '2026.08.19', minimum: '2026.06.09', architecture: 'x64', sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
    const locate = async () => ({ file, receipt, identity, spec })
    const cache = new EngineReceipts(locate)
    try { await work({ file, receipt, spec, cache, locate, changeManifest: () => { identity = 'manifest-2' } }) }
    finally { await cache.stop(); await fs.rm(dir, { recursive: true, force: true }) }
  }

  test('second healthy startup and first use read zero binary hashes and launch zero engine processes', () => sandbox(async ({ cache, locate }) => {
    const first = await cache.ensure('yt-dlp'); assert.equal(first.available, true, JSON.stringify(first))
    const before = { ...verificationMetrics }, launched = launches
    const nextLaunch = new EngineReceipts(locate)
    assert.equal((await nextLaunch.inspect('yt-dlp')).state, 'cached-ready')
    assert.equal((await nextLaunch.ensure('yt-dlp')).available, true)
    assert.deepEqual(verificationMetrics, before)
    assert.equal(launches, launched)
  }))

  test('changed mtime triggers authoritative deep verification once', () => sandbox(async ({ cache, file }) => {
    await cache.ensure('yt-dlp')
    const before = verificationMetrics.hashReads
    await fs.utimes(file, new Date('2020-01-01'), new Date('2020-01-01'))
    assert.equal((await cache.inspect('yt-dlp')).state, 'background-check')
    assert.equal((await cache.ensure('yt-dlp')).available, true)
    assert.equal(verificationMetrics.hashReads, before + 1)
  }))

  test('changed size and corrupt bytes fail SHA-256 before any executable launches', () => sandbox(async ({ cache, file }) => {
    await cache.ensure('yt-dlp')
    const before = launches
    await fs.appendFile(file, 'corruption')
    assert.equal((await cache.inspect('yt-dlp')).state, 'background-check')
    assert.match((await cache.ensure('yt-dlp')).message, /checksum/)
    assert.equal(launches, before)
    assert.equal((await cache.inspect('yt-dlp')).available, false)
  }))

  test('missing engine immediately requires repair without hashing or spawning', () => sandbox(async ({ cache, file }) => {
    await cache.ensure('yt-dlp'); await fs.rm(file)
    const before = { ...verificationMetrics }
    assert.equal((await cache.inspect('yt-dlp')).state, 'repair-required')
    assert.equal((await cache.ensure('yt-dlp')).available, false)
    assert.deepEqual(verificationMetrics, before)
  }))

  test('manifest generation and expected version changes invalidate cached trust', () => sandbox(async ({ cache, changeManifest, spec }) => {
    await cache.ensure('yt-dlp')
    changeManifest()
    const before = verificationMetrics.hashReads
    assert.equal((await cache.inspect('yt-dlp')).state, 'background-check')
    assert.equal((await cache.ensure('yt-dlp')).available, true)
    assert.equal(verificationMetrics.hashReads, before + 1)
    spec.version = '2027.01.01'
    assert.equal((await cache.inspect('yt-dlp')).state, 'background-check')
    assert.equal((await cache.ensure('yt-dlp')).available, false)
  }))

  test('missing or malformed receipt requests verification; filename mismatch is never cached-ready', () => sandbox(async ({ cache, receipt }) => {
    assert.equal((await cache.inspect('yt-dlp')).state, 'background-check')
    await fs.writeFile(receipt, 'not JSON')
    assert.equal((await cache.ensure('yt-dlp')).available, true)
    const saved = JSON.parse(await fs.readFile(receipt)); saved.filename = 'wrong.exe'
    await fs.writeFile(receipt, JSON.stringify(saved))
    assert.equal((await cache.inspect('yt-dlp')).state, 'background-check')
  }))

  test('oversized receipt metadata is rejected before reading/parsing its body', () => sandbox(async ({ cache, receipt }) => {
    await fs.writeFile(receipt, Buffer.alloc(65537, 32))
    assert.equal(await readEngineMetadata(receipt), null)
    assert.equal((await cache.inspect('yt-dlp')).state, 'background-check')
    assert.equal((await cache.ensure('yt-dlp')).available, true)
  }))

  test('concurrent foreground/background requests share a single verification promise', () => sandbox(async ({ locate }) => {
    const gate = deferred(), entered = deferred(); let calls = 0
    const cache = new EngineReceipts(locate, async (...args) => { calls++; entered.resolve(); await gate.promise; return verifyEngine(...args) })
    const a = cache.ensure('yt-dlp'), b = cache.ensure('yt-dlp'), c = cache.ensure('yt-dlp')
    assert.equal(a, b); assert.equal(b, c)
    await entered.promise
    assert.equal(calls, 1)
    gate.resolve()
    assert.ok((await Promise.all([a, b, c])).every(result => result.available))
  }))

  test('first engine use waits for pending verification only when a receipt is invalid', () => sandbox(async ({ locate, cache }) => {
    await cache.ensure('yt-dlp')
    const gate = deferred(); let called = false
    const next = new EngineReceipts(locate, async (...args) => { called = true; await gate.promise; return verifyEngine(...args) })
    assert.equal((await next.ensure('yt-dlp')).available, true)
    assert.equal(called, false)
    await next.invalidate('yt-dlp')
    let settled = false
    const use = next.ensure('yt-dlp').then(() => { settled = true })
    while (!called) await tick()
    assert.equal(settled, false)
    gate.resolve(); await use
  }))

  test('execution failures survive restart and force a new deep check', () => sandbox(async ({ cache, locate }) => {
    await cache.ensure('yt-dlp'); await cache.invalidate('yt-dlp')
    const next = new EngineReceipts(locate)
    assert.equal((await next.inspect('yt-dlp')).state, 'background-check')
    assert.equal((await next.ensure('yt-dlp')).available, true)
  }))

  test('a healthy cached engine never waits behind another engine deep verification', () => sandbox(async ({ file, spec, locate }) => {
    const gate = deferred(), entered = deferred()
    const resolve = async name => {
      const base = await locate()
      return { ...base, spec: { ...spec, name }, receipt: file + '.' + name + '.json' }
    }
    const cache = new EngineReceipts(resolve, async (...args) => { entered.resolve(); await gate.promise; return verifyEngine(...args) })
    await cache.record('ffmpeg', spec.version, spec.sha256)
    const background = cache.ensure('yt-dlp'); await entered.promise

    assert.equal((await cache.ensure('ffmpeg')).available, true)
    gate.resolve(); await background
  }))

  test('Repair Engines explicitly forces deep verification of a healthy receipt', () => sandbox(async ({ cache }) => {
    await cache.ensure('yt-dlp')
    const before = verificationMetrics.hashReads
    assert.equal((await cache.ensure('yt-dlp', true)).available, true)
    assert.equal(verificationMetrics.hashReads, before + 1)
  }))

  test('Repair shares an ongoing cached inspection but still requires a deep check', () => sandbox(async ({ cache }) => {
    await cache.ensure('yt-dlp')
    const before = verificationMetrics.hashReads
    const inspection = cache.ensure('yt-dlp')
    const repair = cache.ensure('yt-dlp', true)
    assert.equal(inspection, repair)
    assert.equal((await repair).available, true)
    assert.equal(verificationMetrics.hashReads, before + 1)
  }))

  test('untrusted ZIP engine without a checksum cannot become verified by measuring its own hash', () => sandbox(async ({ locate, spec }) => {
    delete spec.sha256
    const cache = new EngineReceipts(locate)
    const before = { ...verificationMetrics }
    assert.match((await cache.ensure('yt-dlp')).message, /trusted checksum is missing/)
    assert.deepEqual(verificationMetrics, before)
  }))

  test('permission/spawn/timeout verifier exceptions return failed health without rejection', () => sandbox(async ({ locate }) => {
    for (const code of ['EACCES', 'ENOENT', 'ETIMEDOUT']) {
      const cache = new EngineReceipts(locate, async () => { throw Object.assign(new Error(code), { code }) })
      assert.equal((await cache.ensure('yt-dlp')).available, false)
    }
  }))

  test('shutdown aborts active verification and drains queued checks', () => sandbox(async ({ locate }) => {
    const entered = deferred()
    const cache = new EngineReceipts(locate, async (_file, _spec, signal) => {
      entered.resolve()
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
      signal.throwIfAborted()
    })
    const check = cache.ensure('yt-dlp'); await entered.promise
    await cache.stop()
    assert.equal((await check).available, false)
  }))

  test('UI renders before deferred deep verification completes and failure is contained', async () => {
    const ui = deferred(), verify = deferred(), events = [], errors = []
    const work = afterUiReady(ui.promise, async () => { events.push('verification'); await verify.promise; throw new Error('fixture failure') }, error => errors.push(error.message))
    await tick(); assert.deepEqual(events, [])
    events.push('ui-render'); ui.resolve(); await tick()
    assert.deepEqual(events, ['ui-render', 'verification'])
    verify.resolve(); await work
    assert.deepEqual(errors, ['fixture failure'])
  })

  test('pending updater/network promise cannot delay UI readiness or engine availability', async () => {
    const ui = deferred(), network = deferred(); let checking = false
    const updater = afterUiReady(ui.promise, async () => { checking = true; await network.promise }, () => {})
    await tick(); assert.equal(checking, false)
    ui.resolve(); await ui.promise; await tick()
    assert.equal(checking, true)

    network.resolve(); await updater
  })
})

suite('Engine provisioning', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const crypto = require('node:crypto')
  const Module = require('node:module')
  const originalLoad = Module._load
  const lock = require('../engines.lock.json')
  let root, downloads, offline
  const digest = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')
  Module._load = function(request, parent, ...rest) {
    if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir(), requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}) } }
    if (request === './diagnostics' && parent.filename.endsWith('bootstrap.ts')) return { initializeDiagnostics() {} }
    if (request === 'electron-log') return { info() {}, error() {}, warn() {} }
    return originalLoad.call(this, request, parent, ...rest)
  }
  const { EngineReceipts } = require('../Back-End/electron/engines/engineManager.ts')
  const fixtureVerify = async (file, spec) => ({ name: spec.name, available: await fs.readFile(file, 'utf8').then(data => data === 'engine:' + spec.name, () => false), version: spec.version || 'fixture', message: 'fixture' })
  const fixtureCache = new EngineReceipts(async name => {
    const spec = lock.packages.flatMap(pkg => pkg.engines).find(spec => spec.name === name)
    const file = path.join(root, 'bin', spec.filename)
    return { file, receipt: file + '.integrity.json', identity: JSON.stringify(lock), spec }
  }, fixtureVerify)
  const setup = require('../Back-End/electron/bootstrap.ts')
  const services = {
    receipts: fixtureCache,
    binDirectory: () => path.join(root, 'bin'),
    baselineDirectory: () => path.join(root, 'absent-baseline'),
    hash: digest,
    verify: fixtureVerify,
    download: async (url, destination, hash, _signal, progress) => {
      if (offline) throw Object.assign(new Error('offline'), { code: 'ENOTFOUND' })
      const pkg = lock.packages.find(pkg => pkg.url === url)
      assert.equal(hash, pkg.sha256)
      downloads.push(pkg.name)
      await fs.writeFile(destination, pkg.engines.length === 1 && !url.endsWith('.zip') ? 'engine:' + pkg.engines[0].name : pkg.name)
      progress(10, 10)
    },
    extract: async (archive, stage, names) => {
      const pkg = lock.packages.find(pkg => pkg.name === require('node:fs').readFileSync(archive, 'utf8'))
      assert.deepEqual(names, pkg.engines.map(engine => engine.filename))
      for (const spec of pkg.engines) await fs.writeFile(path.join(stage, spec.filename), 'engine:' + spec.name)
    },
    promote: async (candidate, destination, spec) => {
      assert.equal(await digest(candidate), spec.sha256)
      await fs.copyFile(candidate, destination)
    },
  }
  async function sandbox(work) {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-first-run-'))
    downloads = []; offline = false
    try { await work() } finally { await fs.rm(root, { recursive: true, force: true }) }
  }
  const win = { isDestroyed: () => false, webContents: { send() {} } }

  test('engine setup downloads on first launch, shares FFmpeg package and reuses installed engines offline', () => sandbox(async () => {
    await setup.runSetup(win, true, false, services)
    assert.equal(setup.setupState.status, 'ready')
    assert.deepEqual(downloads, lock.packages.map(pkg => pkg.name))
    assert.equal((await fs.readdir(path.join(root, 'bin'))).filter(name => name.endsWith('.exe')).length, 4)
    assert.ok(!(await fs.readdir(path.join(root, 'bin'))).some(name => name.startsWith('repair-')))
    offline = true
    await setup.runSetup(win, true, false, services)
    assert.equal(setup.setupState.status, 'ready')
    assert.equal(downloads.length, 3)
  }))

  test('engine setup cleans failed downloads and can retry first-run provisioning', () => sandbox(async () => {
    offline = true
    await assert.rejects(setup.runSetup(win, true, false, services), /offline/)
    assert.equal(setup.setupState.status, 'repair-required')
    assert.deepEqual(await fs.readdir(path.join(root, 'bin')), [])
    offline = false
    await setup.runSetup(win, true, false, services)
    assert.equal(setup.setupState.status, 'ready')
  }))

  test('engine setup repairs one corrupt engine with one package download and preserves healthy engines', () => sandbox(async () => {
    await setup.runSetup(win, true, false, services)
    downloads = []
    const probe = path.join(root, 'bin', 'ffprobe.exe')
    const before = await fs.stat(probe)
    await fs.writeFile(path.join(root, 'bin', 'ffmpeg.exe'), 'corrupt')
    await setup.runSetup(win, true, false, services)
    assert.deepEqual(downloads, ['FFmpeg'])
    assert.equal((await fs.stat(probe)).mtimeMs, before.mtimeMs)
    assert.equal(setup.setupState.status, 'ready')
    assert.ok(!(await fs.readdir(path.join(root, 'bin'))).some(name => name.startsWith('repair-')))
  }))
})

suite('Download timeouts', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const crypto = require('node:crypto')
  const { downloadEngine } = require('../Back-End/electron/engines/engineManager.ts')

  test('engine download permits slow active transfers and bounds stalled bodies', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-engine-timeout-'))
    const originalFetch = globalThis.fetch
    const originalTimeout = globalThis.setTimeout

    globalThis.setTimeout = (callback, ms, ...args) => originalTimeout(callback,
      ms === 180_000 ? 30 : ms === 60_000 ? 200 : ms === 30 * 60_000 ? 2000 : ms === 500 || ms === 1000 ? 1 : ms, ...args)
    try {
      const bytes = Buffer.alloc(8192, 42)
      let requests = 0
      globalThis.fetch = async () => {
        requests++
        let offset = 0
        return new Response(new ReadableStream({
          async pull(controller) {
            await new Promise(resolve => originalTimeout(resolve, 40))
            controller.enqueue(bytes.subarray(offset, offset + 1024))
            offset += 1024
            if (offset === bytes.length) controller.close()
          },
        }), { headers: { 'Content-Length': String(bytes.length) } })
      }
      const destination = path.join(dir, 'engine')
      await downloadEngine('https://fixture.invalid/engine', destination, crypto.createHash('sha256').update(bytes).digest('hex'))
      assert.equal(requests, 1, 'An active download must not restart at the old deadline')
      assert.deepEqual(await fs.readFile(destination), bytes)

      let cancellations = 0
      globalThis.fetch = async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(1024)) },
        cancel() { cancellations++ },
      }))
      await assert.rejects(downloadEngine('https://fixture.invalid/stalled', path.join(dir, 'stalled')), /abort/i)
      assert.equal(cancellations, 3, 'Each stalled attempt must release its body')
      assert.deepEqual(await fs.readdir(dir), ['engine'], 'Failed attempts must remove partial files')
    } finally {
      globalThis.fetch = originalFetch
      globalThis.setTimeout = originalTimeout
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

suite('Release packaging', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const asar = require('@electron/asar')
  const { verifyDistribution } = require('../scripts/license-gate.cjs')

  async function fixture(fn, bundledInAsar = false) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-release-'))
    try {
      const source = path.join(directory, 'source')
      const resources = path.join(directory, 'resources')
      await fs.mkdir(source)
      await fs.mkdir(resources)
      await fs.writeFile(path.join(source, 'package.json'), '{}')
      if (bundledInAsar) await fs.writeFile(path.join(source, 'ffmpeg.exe'), 'binary fixture')
      await asar.createPackage(source, path.join(resources, 'app.asar'))
      await fs.writeFile(path.join(resources, 'THIRD-PARTY-NOTICES.txt'), 'Dependency license notices')
      await fn(resources)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  }

  test('release gate accepts a downloader package with notices and no redistributed engines', () => fixture(async resources => {
    assert.deepEqual(verifyDistribution(resources, { reviewed: false }), [])
    await fs.unlink(path.join(resources, 'THIRD-PARTY-NOTICES.txt'))
    assert.throws(() => verifyDistribution(resources, { reviewed: false }))
  }))

  test('release gate rejects an unreviewed engine in extra resources', () => fixture(async resources => {
    await fs.mkdir(path.join(resources, 'engines'))
    await fs.writeFile(path.join(resources, 'engines', 'ffmpeg.exe'), 'binary fixture')
    assert.throws(() => verifyDistribution(resources, { reviewed: false }), /redistribution review is incomplete/)
    assert.throws(() => verifyDistribution(resources, { reviewed: true }), /source archive is required/)
  }))

  test('release gate rejects an unreviewed engine hidden inside ASAR', () => fixture(async resources => {
    assert.throws(() => verifyDistribution(resources, { reviewed: false }), /redistribution review is incomplete/)
  }, true))
})

suite('Generated files', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const { cleanProject } = require('../scripts/clean.cjs')

  async function fixture(work) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-clean-'))
    const app = path.join(directory, 'app')
    await fs.mkdir(app)
    await fs.writeFile(path.join(app, 'package.json'), '{"name":"cortex-dl"}')
    const files = [
      'dist-electron/main.js', 'Front-End/dist/index.html', 'smoke-results/fixture/bin/ffmpeg.exe',
      'bin/ffmpeg.exe', 'build-manifest.json', 'THIRD-PARTY-NOTICES.txt',
      'release/2.2.0/win-unpacked/app.exe', 'release/2.2.0/Cortex-DL-Setup-2.2.0.exe',
      'release/2.2.0/latest.yml', 'release/2.2.0/Cortex-DL-Setup-2.2.0.exe.blockmap',
      'build/installer.nsh', 'Front-End/src/App.tsx', 'Back-End/electron/main.ts',
      '.cortex_temp/paused/partial.part', '.env', 'node_modules/fixture/index.js',
      'engine-baseline/ffmpeg.exe', 'engine-baseline/FFmpeg.download',
    ]
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(app, file)), { recursive: true })
      await fs.writeFile(path.join(app, file), file)
    }
    try { await work(app, directory, files) }
    finally { await fs.rm(directory, { recursive: true, force: true }) }
  }

  test('cleanup preview changes nothing; cleanup preserves source, dependencies, engines, partials and installers', () => fixture(async (app, _directory, files) => {
    const plan = await cleanProject(app, { dryRun: true })
    assert.ok(plan.reduce((sum, entry) => sum + entry.bytes, 0) > 0)
    for (const file of files) assert.equal(await fs.readFile(path.join(app, file), 'utf8'), file)
    await cleanProject(app)
    for (const file of files) {
      const removed = plan.some(entry => path.join(app, file) === entry.target || path.join(app, file).startsWith(entry.target + path.sep))
      if (removed) await assert.rejects(fs.stat(path.join(app, file)), { code: 'ENOENT' })
      else assert.equal(await fs.readFile(path.join(app, file), 'utf8'), file)
    }
    await cleanProject(app)
    await fs.stat(path.join(app, 'release/2.2.0/win-unpacked/app.exe'))
    await cleanProject(app, { packaged: true })
    await assert.rejects(fs.stat(path.join(app, 'release/2.2.0/win-unpacked')), { code: 'ENOENT' })
    for (const file of ['Cortex-DL-Setup-2.2.0.exe', 'latest.yml', 'Cortex-DL-Setup-2.2.0.exe.blockmap']) await fs.stat(path.join(app, 'release/2.2.0', file))
  }))

  test('cleanup refuses redirected parents or nested junctions before deleting outputs', () => fixture(async (app, directory) => {
    const outside = path.join(directory, 'outside')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'keep.txt'), 'preserve')
    const link = path.join(app, 'smoke-results', 'redirected')
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(cleanProject(app), /linked path/)
    await fs.stat(path.join(app, 'dist-electron/main.js'))
    assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'preserve')
    await fs.unlink(link)
    await fs.rm(path.join(app, 'release'), { recursive: true })
    await fs.symlink(outside, path.join(app, 'release'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(cleanProject(app, { packaged: true }), /linked path/)
    await fs.stat(path.join(app, 'dist-electron/main.js'))
  }))

  test('cleanup refuses an unrelated project', () => fixture(async app => {
    await fs.writeFile(path.join(app, 'package.json'), '{"name":"other-app"}')
    await assert.rejects(cleanProject(app), /Cortex DL app directory/)
    await fs.stat(path.join(app, 'dist-electron/main.js'))
  }))
})
