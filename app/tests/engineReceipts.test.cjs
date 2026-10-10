require('./register-ts.cjs')
const test = require('node:test')
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
  if (request === 'node:child_process' && parent.filename.endsWith('engineIntegrity.ts')) return {
    execFile(_file, _args, options, callback) {
      launches++
      const child = new EventEmitter()
      setImmediate(() => callback(options.signal?.aborted ? new Error('aborted') : null, '2026.08.19\n'))
      return child
    },
  }
  return load.call(this, request, parent, ...args)
}
const { EngineReceipts, readEngineMetadata } = require('../Back-End/electron/engineReceipts.ts')
const { verificationMetrics, verifyEngine } = require('../Back-End/electron/engineIntegrity.ts')
const { afterUiReady } = require('../Back-End/electron/startupWork.ts')
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
  // This awaits only a metadata check despite the unresolved deep-check gate.
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
  // UI has resolved while the updater remains pending.
  network.resolve(); await updater
})
