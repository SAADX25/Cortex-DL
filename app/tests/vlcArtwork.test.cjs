require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { pathToFileURL } = require('node:url')
const { vlcArtworkMetadata, vlcArtworkDirectories, refreshVlcArtwork } = require('../Back-End/electron/vlcArtwork.ts')

async function fixture(work) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-vlc-artwork-')), appData = path.join(directory, 'Roaming'), root = path.join(appData, 'vlc')
  const song = path.join(directory, 'أغنية with spaces.mp3'), metadata = { title: 'أغنية اختبار', artist: 'Test artist', attachmentCount: 1 }
  await fs.mkdir(root, { recursive: true }); await fs.writeFile(song, 'untouched media')
  await fs.writeFile(path.join(root, 'vlcrc'), 'untouched VLC settings'); await fs.writeFile(path.join(root, 'ml.xspf'), 'untouched playlist')
  const imageDirectory = path.join(root, vlcArtworkDirectories(song, metadata)[0]), image = path.join(imageDirectory, 'art.jpg'), backups = path.join(root, 'CortexArtworkBackups')
  await fs.mkdir(imageDirectory, { recursive: true }); await fs.writeFile(image, 'old cover')
  try { await work({ directory, appData, root, song, metadata, imageDirectory, image, backups }) }
  finally { await fs.rm(directory, { recursive: true, force: true }) }
}

test('VLC cache identities match the real song cache and safely support album, Unicode and multiple attachment names', () => {
  const song = 'C:\\Users\\saadr\\Downloads\\Nightcore_-_Dreams_pt.mp3'
  assert.equal(vlcArtworkDirectories(song, { title: 'Nightcore - Dreams pt. II - (Lyrics)' })[0], path.join('art', 'arturl', '56c260942bcd224810da3700088596d6'))
  assert.equal(vlcArtworkDirectories(song, { artist: ' Artist/اسم ', album: '..' })[0], path.join('art', 'artistalbum', '_Artist_اسم_', '__'))
  assert.equal(vlcArtworkDirectories(song, { attachmentCount: 2 }).length, 3)
  assert.equal(vlcArtworkDirectories(song, { attachmentCount: 1000000 }).length, 33, 'Bound metadata-derived candidates')
  assert.deepEqual(vlcArtworkDirectories('relative.mp3', {}), []); assert.deepEqual(vlcArtworkDirectories(song + '\0', {}), [])
  const tags = vlcArtworkMetadata({ TITLE: 'عنوان', ARTIST: 'فنان', ALBUM: 'ألبوم' }, 2)
  assert.deepEqual(tags, { title: 'عنوان', artist: 'فنان', album: 'ألبوم', attachmentCount: 2 })
  assert.equal(vlcArtworkDirectories(song, tags)[0], path.join('art', 'artistalbum', 'فنان', 'ألبوم'))
})

test('VLC refresh retains one backup per matching cover and preserves other songs, preferences and media', () => fixture(async ({ appData, root, song, metadata, image, imageDirectory, backups }) => {
  const other = path.join(root, vlcArtworkDirectories(song, { title: 'Other song' })[0], 'art.jpg')
  await fs.mkdir(path.dirname(other), { recursive: true }); await fs.writeFile(other, 'other artwork')
  const unknown = path.join(imageDirectory, 'unknown.txt'); await fs.writeFile(unknown, 'unknown cache format')
  assert.equal(await refreshVlcArtwork(song, metadata, appData), 1)
  const names = await fs.readdir(backups); assert.equal(names.length, 1)
  assert.equal(await fs.readFile(path.join(backups, names[0]), 'utf8'), 'old cover')
  await fs.writeFile(image, 'new cached cover'); assert.equal(await refreshVlcArtwork(song, metadata, appData), 1)
  assert.deepEqual(await fs.readdir(backups), names); assert.equal(await fs.readFile(path.join(backups, names[0]), 'utf8'), 'new cached cover')
  assert.equal(await fs.readFile(other, 'utf8'), 'other artwork'); assert.equal(await fs.readFile(unknown, 'utf8'), 'unknown cache format')
  assert.equal(await fs.readFile(song, 'utf8'), 'untouched media'); assert.equal(await fs.readFile(path.join(root, 'vlcrc'), 'utf8'), 'untouched VLC settings'); assert.equal(await fs.readFile(path.join(root, 'ml.xspf'), 'utf8'), 'untouched playlist')
  assert.equal(await refreshVlcArtwork(song, metadata, appData), 0)
}))

test('artist/album caches and only legacy UID references to the matched images are refreshed', () => fixture(async ({ appData, root, song, backups }) => {
  const metadata = { artist: 'فنان / Artist', album: 'Album:One #hash', title: 'Song' }, album = path.join(root, vlcArtworkDirectories(song, metadata)[0])
  await fs.mkdir(album, { recursive: true }); const image = path.join(album, 'art.png'); await fs.writeFile(image, 'album art')
  const references = [path.join(root, 'by-iiuid', 'a'.repeat(32), 'arturl'), path.join(root, 'by-iiuid', 'b'.repeat(32), 'arturl'), path.join(root, 'by-iiuid', 'c'.repeat(32), 'arturl')]
  for (const file of references) await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(references[0], 'file://' + image); await fs.writeFile(references[1], pathToFileURL(image).href)
  await fs.writeFile(references[2], 'file://' + path.join(root, 'art', 'artistalbum', 'Other', 'Album', 'art.jpg'))
  assert.equal(await refreshVlcArtwork(song, metadata, appData), 3)
  assert.equal((await fs.readdir(backups)).length, 3)
  for (const file of [image, ...references.slice(0, 2)]) await assert.rejects(fs.stat(file), { code: 'ENOENT' })
  assert.match(await fs.readFile(references[2], 'utf8'), /Other/)
}))

test('cache links, redirected backup directories and oversized images are skipped', () => fixture(async ({ directory, appData, song, metadata, image, imageDirectory, backups }) => {
  const outside = path.join(directory, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'art.jpg'), 'unrelated bytes')
  await fs.symlink(outside, backups, 'junction')
  assert.equal(await refreshVlcArtwork(song, metadata, appData), 0); assert.equal(await fs.readFile(image, 'utf8'), 'old cover')
  await fs.unlink(backups); await fs.rename(imageDirectory, imageDirectory + '-original'); await fs.symlink(outside, imageDirectory, 'junction')
  assert.equal(await refreshVlcArtwork(song, metadata, appData), 0); assert.equal(await fs.readFile(path.join(outside, 'art.jpg'), 'utf8'), 'unrelated bytes')
  await fs.unlink(imageDirectory); await fs.rename(imageDirectory + '-original', imageDirectory)
  await fs.unlink(image); await fs.symlink(outside, image, 'junction')
  assert.equal(await refreshVlcArtwork(song, metadata, appData), 0)
  await fs.unlink(image); await fs.writeFile(image, Buffer.alloc(8 * 1024 * 1024 + 1))
  assert.equal(await refreshVlcArtwork(song, metadata, appData), 0); assert.equal((await fs.stat(image)).size, 8 * 1024 * 1024 + 1)
}))

test('VLC refresh tolerates realpath alias differences while validating cache files', () => fixture(async ({ appData, image, backups, song, metadata }) => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })
  const originalRealpath = fs.realpath
  fs.realpath = async () => { throw new Error('short-name alias unavailable') }
  try {
    assert.equal(await refreshVlcArtwork(song, metadata, appData), 1)
    assert.equal((await fs.readdir(backups)).length, 1)
    await assert.rejects(fs.stat(image), { code: 'ENOENT' })
  } finally { fs.realpath = originalRealpath; Object.defineProperty(process, 'platform', platform) }
}))

test('invalid cache roots and paths are ignored without resetting VLC', () => fixture(async ({ appData, song, metadata, image }) => {
  for (const [file, cache] of [['relative.mp3', appData], [song + '\0', appData], [song, 'relative'], [song, undefined]]) {
    assert.equal(await refreshVlcArtwork(file, metadata, cache === undefined ? path.join(appData, 'absent') : cache), 0)
  }
  assert.equal(await fs.readFile(image, 'utf8'), 'old cover')
}))

test('independent external player cache failures cannot prevent the other player refresh', async () => {
  const Module = require('node:module'), originalLoad = Module._load, calls = [], metadata = { title: 'Song' }
  Module._load = function(request, ...args) {
    if (request === './windowsPlayerArtwork') return { refreshWindowsPlayerArtwork: async file => { calls.push(['windows', file]); throw Error('Player unavailable') } }
    if (request === './vlcArtwork') return { refreshVlcArtwork: async (file, tags) => { calls.push(['vlc', file, tags]); return 1 } }
    return originalLoad.call(this, request, ...args)
  }
  try {
    const { refreshExternalPlayerArtwork } = require('../Back-End/electron/externalPlayerArtwork.ts')
    await refreshExternalPlayerArtwork('C:\\song.mp3', metadata)
    assert.deepEqual(calls, [['windows', 'C:\\song.mp3'], ['vlc', 'C:\\song.mp3', metadata]])
  } finally { Module._load = originalLoad }
})
