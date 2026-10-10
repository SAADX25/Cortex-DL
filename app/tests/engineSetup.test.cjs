require('./register-ts.cjs')
const test = require('node:test')
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
const { EngineReceipts } = require('../Back-End/electron/engineReceipts.ts')
const fixtureVerify = async (file, spec) => ({ name: spec.name, available: await fs.readFile(file, 'utf8').then(data => data === 'engine:' + spec.name, () => false), version: spec.version || 'fixture', message: 'fixture' })
const fixtureCache = new EngineReceipts(async name => {
  const spec = lock.packages.flatMap(pkg => pkg.engines).find(spec => spec.name === name)
  const file = path.join(root, 'bin', spec.filename)
  return { file, receipt: file + '.integrity.json', identity: JSON.stringify(lock), spec }
}, fixtureVerify)
Module._load = function(request, parent, ...rest) {
  if (request === './engineReadiness' && parent.filename.endsWith('setup.ts')) return { engineReceipts: fixtureCache, engineNames: lock.packages.flatMap(pkg => pkg.engines.map(spec => spec.name)) }
  if (request === 'electron') return {}
  if (request === 'electron-log') return { info() {}, error() {} }
  if (request === './paths' && (parent.filename.endsWith('setup.ts') || parent.filename.endsWith('engineReadiness.ts'))) return {
    getBaselineDirectory: () => path.join(root, 'absent-baseline'),
    getBinDirectory: () => path.join(root, 'bin'),
    getBinaryPath: name => path.join(root, 'bin', `${name}.exe`),
  }
  if (request === './engineIntegrity' && parent.filename.endsWith('setup.ts')) return {
    sha256: digest,
    verifyEngine: fixtureVerify,
    downloadEngine: async (url, destination, hash, _signal, progress) => {
      if (offline) throw Object.assign(new Error('offline'), { code: 'ENOTFOUND' })
      const pkg = lock.packages.find(pkg => pkg.url === url)
      assert.equal(hash, pkg.sha256)
      downloads.push(pkg.name)
      await fs.writeFile(destination, pkg.engines.length === 1 && !url.endsWith('.zip') ? `engine:${pkg.engines[0].name}` : pkg.name)
      progress(10, 10)
    },
    extractEngineZip: async (archive, stage, names) => {
      const pkg = lock.packages.find(pkg => pkg.name === require('node:fs').readFileSync(archive, 'utf8'))
      assert.deepEqual(names, pkg.engines.map(engine => engine.filename))
      for (const spec of pkg.engines) await fs.writeFile(path.join(stage, spec.filename), `engine:${spec.name}`)
    },
    promoteEngine: async (candidate, destination, spec) => {
      assert.equal(await digest(candidate), spec.sha256)
      await fs.copyFile(candidate, destination)
    },
  }
  return originalLoad.call(this, request, parent, ...rest)
}
const setup = require('../Back-End/electron/setup.ts')
async function sandbox(work) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-first-run-'))
  downloads = []; offline = false
  try { await work() } finally { await fs.rm(root, { recursive: true, force: true }) }
}
const win = { isDestroyed: () => false, webContents: { send() {} } }

test('engine setup downloads on first launch, shares FFmpeg package and reuses installed engines offline', () => sandbox(async () => {
  await setup.runSetup(win)
  assert.equal(setup.setupState.status, 'ready')
  assert.deepEqual(downloads, lock.packages.map(pkg => pkg.name))
  assert.equal((await fs.readdir(path.join(root, 'bin'))).filter(name => name.endsWith('.exe')).length, 4)
  assert.ok(!(await fs.readdir(path.join(root, 'bin'))).some(name => name.startsWith('repair-')))
  offline = true
  await setup.runSetup(win)
  assert.equal(setup.setupState.status, 'ready')
  assert.equal(downloads.length, 3)
}))

test('engine setup cleans failed downloads and can retry first-run provisioning', () => sandbox(async () => {
  offline = true
  await assert.rejects(setup.runSetup(win), /offline/)
  assert.equal(setup.setupState.status, 'repair-required')
  assert.deepEqual(await fs.readdir(path.join(root, 'bin')), [])
  offline = false
  await setup.runSetup(win)
  assert.equal(setup.setupState.status, 'ready')
}))

test('engine setup repairs one corrupt engine with one package download and preserves healthy engines', () => sandbox(async () => {
  await setup.runSetup(win)
  downloads = []
  const probe = path.join(root, 'bin', 'ffprobe.exe')
  const before = await fs.stat(probe)
  await fs.writeFile(path.join(root, 'bin', 'ffmpeg.exe'), 'corrupt')
  await setup.runSetup(win)
  assert.deepEqual(downloads, ['FFmpeg'])
  assert.equal((await fs.stat(probe)).mtimeMs, before.mtimeMs)
  assert.equal(setup.setupState.status, 'ready')
  assert.ok(!(await fs.readdir(path.join(root, 'bin'))).some(name => name.startsWith('repair-')))
}))
