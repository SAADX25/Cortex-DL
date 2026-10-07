require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')
const load = Module._load
Module._load = function(request, ...args) {
  if (request === 'electron') return { app: {}, ipcMain: {} }
  if (request === 'electron-log') return {}
  return load.call(this, request, ...args)
}
const { verifyEngine, promoteEngine, extractEngineZip, downloadEngine, sha256 } = require('../Back-End/electron/engineIntegrity.ts')
const { validateIpcArguments } = require('../Back-End/electron/ipcSecurity.ts')
const { redact } = require('../Back-End/electron/diagnostics.ts')
const { parseMediaRange } = require('../Back-End/electron/mediaRange.ts')
const spec = { name: 'yt-dlp', filename: 'yt-dlp.exe', architecture: 'x64', minimum: '2026.06.09' }
async function sandbox(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-integrity-'))
  try { await fn(dir) } finally { await fs.rm(dir, { recursive: true, force: true }) }
}
test('production hardening release version rejects mismatched tags', () => {
  const { verifyVersion } = require('../scripts/verify-release.cjs')
  verifyVersion('v2.1.5')
  assert.throws(() => verifyVersion('v2.1.0'), /Tag must equal/)
})
test('production hardening IPC rejects malformed paths, URLs and destructive flags', () => {
  assert.throws(() => validateIpcArguments('cortexdl:open-file', ['C:\\bad.exe']))
  assert.throws(() => validateIpcArguments('cortexdl:open-folder', ['relative']))
  assert.throws(() => validateIpcArguments('cortexdl:open-external', ['file:///C:/private']))
  assert.throws(() => validateIpcArguments('cortexdl:set-concurrency', [Infinity]))
  assert.throws(() => validateIpcArguments('cortexdl:downloads:delete', ['task', 'yes']))
  validateIpcArguments('cortexdl:set-concurrency', [3])
  for (const extension of ['mp4', 'mkv', 'avi', 'mov', 'webm', 'ogv', 'm4v', 'gif', 'mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus', 'wma']) {
    validateIpcArguments('cortexdl:open-file', [path.resolve(`fixture.${extension}`)])
  }
})
test('production hardening logs redact signed URLs and credentials', () => {
  const output = redact('https://host/path?token=SENSITIVE\nAuthorization: Bearer SENSITIVE\nCookie: session=SENSITIVE\npassword=SENSITIVE')
  assert.ok(!output.includes('SENSITIVE'))
  assert.ok(!output.includes('host'))
})
test('production hardening missing and corrupt engines cannot become ready', () => sandbox(async dir => {
  assert.match((await verifyEngine(path.join(dir, 'missing.exe'), spec)).message, /missing/)
  const file = path.join(dir, 'bad.exe'); await fs.writeFile(file, 'broken')
  assert.equal((await verifyEngine(file, spec)).available, false)
}))
test('production hardening failed replacement preserves previous executable', () => sandbox(async dir => {
  const final = path.join(dir, 'engine.exe'), candidate = path.join(dir, 'bad.tmp')
  await fs.writeFile(final, 'working sentinel'); await fs.writeFile(candidate, 'broken')
  await assert.rejects(promoteEngine(candidate, final, spec), /corrupt/)
  assert.equal(await fs.readFile(final, 'utf8'), 'working sentinel')
}))
test('production hardening ZIP rejects traversal and duplicate executable entries', () => sandbox(async dir => {
  const Zip = require('adm-zip')
  const archive = new Zip(); archive.addFile('xx/yt-dlp.exe', Buffer.alloc(100000))
  const file = path.join(dir, 'bad.zip'); const buffer = archive.toBuffer()
  let offset = 0; while ((offset = buffer.indexOf('xx/yt-dlp.exe', offset)) >= 0) { buffer.write('../yt-dlp.exe', offset); offset += 12 }
  await fs.writeFile(file, buffer)
  await assert.rejects(extractEngineZip(file, dir, ['yt-dlp.exe']), /Unsafe/)
  const duplicate = new Zip(); duplicate.addFile('a/yt-dlp.exe', Buffer.alloc(100000)); duplicate.addFile('b/yt-dlp.exe', Buffer.alloc(100000)); duplicate.writeZip(file)
  await assert.rejects(extractEngineZip(file, dir, ['yt-dlp.exe']), /Invalid/)
}))
test('production hardening download rejects insecure transport and cleans staging', () => sandbox(async dir => {
  const controller = new AbortController(); controller.abort()
  await assert.rejects(downloadEngine('http://127.0.0.1/engine', path.join(dir, 'engine'), undefined, controller.signal), /HTTPS/)
  assert.deepEqual(await fs.readdir(dir), [])
}))
test('production hardening bundled hashes reject modification', () => sandbox(async dir => {
  const file = path.join(dir, 'large.exe'); await fs.writeFile(file, Buffer.alloc(100000))
  assert.equal((await verifyEngine(file, { ...spec, sha256: '0'.repeat(64) })).available, false)
  assert.equal((await sha256(file)).length, 64)
}))

test('production hardening ZIP extraction keeps the event loop responsive', () => sandbox(async dir => {
  const Zip = require('adm-zip')
  const archive = new Zip(); archive.addFile('bundle/ffmpeg.exe', Buffer.alloc(64 * 1024 * 1024, 42))
  const file = path.join(dir, 'engine.zip'); archive.writeZip(file)
  let ticks = 0
  const heartbeat = setInterval(() => ticks++, 5)
  try { await extractEngineZip(file, dir, ['ffmpeg.exe']) } finally { clearInterval(heartbeat) }
  assert.ok(ticks >= 2, `Main event loop stalled during extraction (${ticks} heartbeats)`)
  assert.equal((await fs.stat(path.join(dir, 'ffmpeg.exe'))).size, 64 * 1024 * 1024)
}))

test('production hardening engine download reports bytes with and without Content-Length', () => sandbox(async dir => {
  const fetch = globalThis.fetch
  try {
    for (const known of [true, false]) {
      globalThis.fetch = async () => new Response(new ReadableStream({
        async start(controller) {
          controller.enqueue(new Uint8Array(1024)); await new Promise(resolve => setTimeout(resolve, 120))
          controller.enqueue(new Uint8Array(1024)); controller.close()
        },
      }), { headers: known ? { 'Content-Length': '2048' } : {} })
      const reports = []
      await downloadEngine('https://fixture.invalid/engine', path.join(dir, `engine-${known}`), undefined, undefined, (...args) => reports.push(args))
      assert.deepEqual(reports[0], [0, known ? 2048 : null])
      assert.deepEqual(reports.at(-1), [2048, known ? 2048 : null])
      assert.ok(reports.some(([bytes]) => bytes === 1024))
    }
  } finally { globalThis.fetch = fetch }
}))

test('production hardening installer fixture initializes a pristine workspace', () => sandbox(async dir => {
  const script = path.join(dir, 'app/scripts/installer-upgrade.cjs')
  await fs.mkdir(path.dirname(script), { recursive: true })
  await fs.copyFile(path.join(process.cwd(), 'scripts/installer-upgrade.cjs'), script)
  const stub = path.join(dir, 'stub.cjs')
  await fs.writeFile(stub, `require('node:child_process').spawnSync = () => ({status:0,stdout:'',stderr:''})`)
  const result = require('node:child_process').spawnSync(process.execPath, ['--require', stub, script], { env: { ...process.env, APPDATA: path.join(dir, 'profile') }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.ok((await fs.stat(path.join(dir, 'app/installer-validation/seed-legacy.cjs'))).isFile())
  assert.equal(await fs.access(path.join(dir, 'profile/Cortex DL')).then(() => true, () => false), false)
}))
test('production hardening media ranges support suffixes and reject malformed or overflowing requests', () => {
  assert.deepEqual(parseMediaRange('bytes=-64', 100), [36, 99])
  assert.deepEqual(parseMediaRange('bytes=5-', 100), [5, 99])
  assert.deepEqual(parseMediaRange('bytes=0-1000', 100), [0, 99])
  for (const header of ['bytes=-0', 'bytes=100-', 'bytes=9-1', 'bytes=0-1,2-3', 'invalid', 'bytes=9007199254740993-']) assert.equal(parseMediaRange(header, 100), null)
})
