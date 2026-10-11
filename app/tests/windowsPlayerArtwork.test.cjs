require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const Module = require('node:module'), originalLoad = Module._load
const nativeCalls = []
Module._load = function(request, ...args) {
  if (request === 'node:child_process') return { execFile: (binary, args, options, callback) => { nativeCalls.push({ binary, args, options }); callback(null) } }
  return originalLoad.call(this, request, ...args)
}
const { windowsPlayerArtworkPrefixes, refreshWindowsPlayerArtwork, closeWindowsMediaPlayer } = require('../Back-End/electron/windowsPlayerArtwork.ts')
Module._load = originalLoad

async function fixture(work) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-windows-artwork-'))
  const local = path.join(directory, 'Local'), app = path.join(local, 'Packages', 'Microsoft.ZuneMusic_8wekyb3d8bbwe')
  const cache = path.join(app, 'LocalCache'), images = path.join(cache, 'Image'), backups = path.join(cache, 'CortexArtworkBackups')
  await fs.mkdir(images, { recursive: true }); await fs.mkdir(path.join(app, 'LocalState'))
  const song = path.join(directory, 'أغنية with spaces.mp3'), db = path.join(app, 'LocalState', 'MediaPlayer.db')
  await fs.writeFile(song, 'untouched music'); await fs.writeFile(db, 'untouched library')
  try { await work({ directory, local, cache, images, backups, song, db }) }
  finally { await fs.rm(directory, { recursive: true, force: true }) }
}

test('Windows Media Player cache keys match the observed song identity', () => {
  assert.ok(windowsPlayerArtworkPrefixes('C:\\Users\\saadr\\Downloads\\Nightcore_-_Dreams_pt.mp3').includes('40-6E-87-2A-A3-A7-F1-3B-62-C2-7F-6B-2F-CC-42-17-5B-30-86-B5-E2-0B-6D-DD-FF-A8-3A-90-67-38-D6-19'))
})

test('automatic refresh backs up only the changed song cache, retains one backup and preserves other songs and library data', () => fixture(async ({ local, images, backups, song, db }) => {
  const prefix = windowsPlayerArtworkPrefixes(song)[0], other = windowsPlayerArtworkPrefixes(path.join(path.dirname(song), 'other.mp3'))[0]
  const names = [prefix + '-0-512-512', prefix + '-0-96-96']
  for (const name of names) await fs.writeFile(path.join(images, name), 'old cover')
  const otherName = other + '-0-512-512', unknownName = prefix + '-unknown'
  await fs.writeFile(path.join(images, otherName), 'other cover'); await fs.writeFile(path.join(images, unknownName), 'unknown format')
  let closed = 0
  const close = async () => { closed++; assert.equal((await fs.readdir(images)).length, 4, 'Close the player before moving cached files'); return true }
  assert.equal(await refreshWindowsPlayerArtwork(song, local, close), 2)
  assert.equal(closed, 1)
  for (const name of names) assert.equal(await fs.readFile(path.join(backups, name), 'utf8'), 'old cover')
  assert.equal(await fs.readFile(path.join(images, otherName), 'utf8'), 'other cover')
  assert.equal(await fs.readFile(path.join(images, unknownName), 'utf8'), 'unknown format')
  assert.equal(await fs.readFile(song, 'utf8'), 'untouched music'); assert.equal(await fs.readFile(db, 'utf8'), 'untouched library')
  await fs.writeFile(path.join(images, names[0]), 'next cover')
  assert.equal(await refreshWindowsPlayerArtwork(song, local, async () => true), 1)
  assert.equal(await fs.readFile(path.join(backups, names[0]), 'utf8'), 'next cover')
  assert.equal((await fs.readdir(backups)).length, 2, 'Repeated edits must not accumulate unlimited backups')
}))

test('no matching cache, blocked graceful close and unsupported cache formats leave cached files untouched', () => fixture(async ({ local, images, song }) => {
  const untouched = async () => assert.fail('Must not close a player without this song cache')
  assert.equal(await refreshWindowsPlayerArtwork(song, local, untouched), 0)
  const name = windowsPlayerArtworkPrefixes(song)[0] + '-0-512-512', target = path.join(images, name)
  await fs.writeFile(target, 'cached cover')
  assert.equal(await refreshWindowsPlayerArtwork(song, local, async () => false), 0)
  assert.equal(await fs.readFile(target, 'utf8'), 'cached cover')
  assert.equal(await refreshWindowsPlayerArtwork('relative.mp3', local, untouched), 0)
  assert.equal(await refreshWindowsPlayerArtwork(song + '\0', local, untouched), 0)
}))

test('redirected cache and backup directories are skipped before closing the player', () => fixture(async ({ directory, local, images, backups, song }) => {
  const outside = path.join(directory, 'unrelated'); await fs.mkdir(outside)
  const name = windowsPlayerArtworkPrefixes(song)[0] + '-0-512-512'
  await fs.writeFile(path.join(images, name), 'cached cover')
  await fs.symlink(outside, backups, 'junction')
  const untouched = async () => assert.fail('Must not close a player for redirected cache paths')
  assert.equal(await refreshWindowsPlayerArtwork(song, local, untouched), 0)
  assert.equal(await fs.readFile(path.join(images, name), 'utf8'), 'cached cover')
  await fs.unlink(backups)
  await fs.rename(images, images + '-original'); await fs.symlink(outside, images, 'junction')
  await fs.writeFile(path.join(outside, name), 'unrelated file')
  assert.equal(await refreshWindowsPlayerArtwork(song, local, untouched), 0)
  assert.equal(await fs.readFile(path.join(outside, name), 'utf8'), 'unrelated file')
}))

test('Windows cache refresh tolerates realpath alias differences for validated files', () => fixture(async ({ local, images, backups, song }) => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })
  const name = windowsPlayerArtworkPrefixes(song)[0] + '-0-512-512'
  await fs.writeFile(path.join(images, name), 'cached cover')
  const originalRealpath = fs.realpath
  fs.realpath = async () => { throw new Error('short-name alias unavailable') }
  try {
    assert.equal(await refreshWindowsPlayerArtwork(song, local, async () => true), 1)
    assert.equal(await fs.readFile(path.join(backups, name), 'utf8'), 'cached cover')
  } finally { fs.realpath = originalRealpath; Object.defineProperty(process, 'platform', platform) }
}))

test('Media Player close is bounded, checks the Microsoft package install path and uses no forced termination', async () => {
  assert.equal(await closeWindowsMediaPlayer(), true)
  const { binary, args, options } = nativeCalls.at(-1), script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
  assert.match(binary, /WindowsPowerShell/); assert.match(script, /Get-Process -Name 'Microsoft\.Media\.Player'/)
  assert.match(script, /CloseMainWindow\(\)/); assert.match(script, /WaitForExit\(2000\)/)
  assert.match(script, /WindowsApps/); assert.match(script, /Microsoft\\\.ZuneMusic/)
  assert.ok(!/Stop-Process|taskkill|\.Kill\(/.test(script))
  assert.equal(options.windowsHide, true); assert.equal(options.timeout, 7000)
})

test('artwork IPC validates explicit player-refresh consent and disallows it for unrelated operations', () => {
  const { validateIpcArguments } = require('../Back-End/electron/ipcSecurity.ts')
  for (const action of ['artwork-select', 'artwork-remove', 'artwork-embed']) {
    for (const args of [['song'], ['song', true], ['song', false]]) validateIpcArguments('cortexdl:library:' + action, args)
    for (const value of ['true', 1, null, {}, undefined]) assert.throws(() => validateIpcArguments('cortexdl:library:' + action, ['song', value]))
    assert.throws(() => validateIpcArguments('cortexdl:library:' + action, ['song', true, true]))
  }
  for (const action of ['play', 'remove', 'thumbnail', 'artwork-info']) assert.throws(() => validateIpcArguments('cortexdl:library:' + action, ['song', true]))
})
