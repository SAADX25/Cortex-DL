require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { MediaLibrary } = require('../Back-End/electron/mediaLibrary.ts')
const { libraryMediaKind } = require('../Shared/mediaLibrary.ts')
async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-library-'))
  try { await run(directory, path.join(directory, 'library.json')) }
  finally { await fs.rm(directory, { recursive: true, force: true }) }
}

test('media library persists mixed Unicode paths, deduplicates imports and never changes source files', () => fixture(async (directory, saved) => {
  const video = path.join(directory, 'فيديو طويل.MP4'), audio = path.join(directory, 'music.flac'), unsupported = path.join(directory, 'private.exe')
  await fs.writeFile(video, 'video sentinel'); await fs.writeFile(audio, 'audio sentinel'); await fs.writeFile(unsupported, 'unsupported')
  const library = new MediaLibrary(saved), result = await library.add([video, audio, video, unsupported, path.join(directory, 'missing.mp3'), directory])
  assert.equal(result.added, 2); assert.equal(result.duplicates, 1); assert.equal(result.rejected.length, 3)
  assert.deepEqual(result.items.map(item => item.kind), ['video', 'audio'])
  assert.equal(libraryMediaKind('FILE.M4A'), 'audio'); assert.equal(libraryMediaKind('image.gif'), null)
  const restored = new MediaLibrary(saved)
  assert.deepEqual(await restored.list(), result.items)
  const played = await restored.play(result.items[0].id)
  assert.ok(played.lastPlayedAt > 0); assert.equal(played.filePath, video)
  assert.equal((await new MediaLibrary(saved).list())[0].lastPlayedAt, played.lastPlayedAt)
  await restored.remove(played.id)
  assert.equal((await restored.list()).length, 1)
  assert.equal(await fs.readFile(video, 'utf8'), 'video sentinel'); assert.equal(await fs.readFile(audio, 'utf8'), 'audio sentinel')
}))

test('media library retains missing entries, refuses playback and relocates without losing identity', () => fixture(async (directory, saved) => {
  const original = path.join(directory, 'original.mp4'), moved = path.join(directory, 'moved.mp4'), other = path.join(directory, 'other.mp3')
  await fs.writeFile(original, 'media'); await fs.writeFile(other, 'other')
  const library = new MediaLibrary(saved), result = await library.add([original, other]), id = result.items[0].id
  await fs.rename(original, moved)
  assert.equal((await library.list())[0].availability, 'missing')
  await assert.rejects(library.play(id), /MEDIA_LIBRARY_MISSING/)
  await assert.rejects(library.relocate(id, other), /MEDIA_LIBRARY_DUPLICATE/)
  const entries = await library.relocate(id, moved)
  assert.equal(entries[0].id, id); assert.equal(entries[0].filePath, moved); assert.equal(entries[0].availability, 'available')
  assert.equal(entries[0].addedAt, result.items[0].addedAt)
  assert.equal((await library.play(id)).filePath, moved)
}))

test('library streaming grants exact imported files, survives restart and revokes removed or relocated references', () => fixture(async (directory, saved) => {
  const selected = path.join(directory, 'موسيقى.mp3'), sibling = path.join(directory, 'other.mp3'), moved = path.join(directory, 'moved.mp3')
  await fs.writeFile(selected, 'selected'); await fs.writeFile(sibling, 'unselected'); await fs.writeFile(moved, 'moved')
  const library = new MediaLibrary(saved), realSelected = await fs.realpath(selected), realSibling = await fs.realpath(sibling)
  assert.equal(await library.canServe(selected, realSelected), false)
  const { items } = await library.add([selected])
  assert.equal(await library.canServe(selected, realSelected), true)
  assert.equal(await library.canServe(sibling, realSibling), false, 'Importing a file must not grant its whole directory')
  assert.equal(await library.canServe(selected, realSibling), false, 'Resolved file must match the selected reference')
  const restored = new MediaLibrary(saved)
  assert.equal(await restored.canServe(selected, realSelected), true)
  await restored.relocate(items[0].id, moved)
  assert.equal(await restored.canServe(selected, realSelected), false)
  assert.equal(await restored.canServe(moved, await fs.realpath(moved)), true)
  await restored.remove(items[0].id)
  assert.equal(await restored.canServe(moved, await fs.realpath(moved)), false)
  assert.equal(await fs.readFile(selected, 'utf8'), 'selected')
}))

test('manual song covers persist per item, survive relocation, preserve sources and roll back failed metadata writes', () => fixture(async (directory, saved) => {
  const a = path.join(directory, 'a.mp3'), b = path.join(directory, 'b.mp3'), moved = path.join(directory, 'moved.mp3')
  await fs.writeFile(a, 'original a'); await fs.writeFile(b, 'original b')
  const library = new MediaLibrary(saved), { items } = await library.add([a, b])
  const image = require('node:child_process').execFileSync(path.resolve(__dirname, '../engine-baseline/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=80x80', '-frames:v', '1', '-threads', '1', '-c:v', 'mjpeg', '-f', 'image2pipe', 'pipe:1'], { windowsHide: true, timeout: 10000 })
  const updated = await library.setArtwork(items[0].id, image)
  assert.match(updated[0].artwork, /^[a-f0-9]{64}$/); assert.equal(updated[1].artwork, undefined)
  const restored = new MediaLibrary(saved)
  assert.deepEqual(await restored.getArtwork(items[0].id), image)
  assert.equal(await restored.getArtwork(items[1].id), null)
  await fs.rename(a, moved); await restored.relocate(items[0].id, moved)
  assert.deepEqual(await restored.getArtwork(items[0].id), image)
  await restored.setArtwork(items[1].id, image)
  await restored.setArtwork(items[0].id, null)
  assert.deepEqual(await restored.getArtwork(items[1].id), image, 'Shared image must remain for the other song')
  await restored.remove(items[1].id)
  assert.deepEqual(await fs.readdir(path.join(directory, 'library-artwork')), [])
  await assert.rejects(restored.setArtwork(items[0].id, Buffer.from('bad image')), /ARTWORK_INVALID/)
  await fs.rename(saved, saved + '.backup'); await fs.mkdir(saved)
  await assert.rejects(restored.setArtwork(items[0].id, image))
  assert.equal(await restored.getArtwork(items[0].id), null)
  assert.deepEqual(await fs.readdir(path.join(directory, 'library-artwork')), [], 'Failed save must discard the new cover')
  assert.equal(await fs.readFile(moved, 'utf8'), 'original a'); assert.equal(await fs.readFile(b, 'utf8'), 'original b')
}))

test('concurrent library mutations serialize, failed persistence does not publish changes and retry remains usable', () => fixture(async (directory, saved) => {
  const a = path.join(directory, 'a.mp4'), b = path.join(directory, 'b.wav')
  await fs.writeFile(a, 'a'); await fs.writeFile(b, 'b')
  const library = new MediaLibrary(saved)
  await Promise.all([library.add([a]), library.add([b]), library.add([a])])
  assert.equal((await new MediaLibrary(saved).list()).length, 2)
  const before = await library.list()
  await fs.rename(saved, saved + '.backup'); await fs.mkdir(saved)
  await assert.rejects(library.remove(before[0].id))
  assert.deepEqual(await library.list(), before)
  assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0)
  await fs.rmdir(saved); await fs.rename(saved + '.backup', saved)
  assert.equal((await library.remove(before[0].id)).length, 1)
}))

test('malformed saved libraries and untrusted paths are rejected without overwriting saved data', () => fixture(async (directory, saved) => {
  const raw = '{malformed library'
  await fs.writeFile(saved, raw)
  const library = new MediaLibrary(saved)
  await assert.rejects(library.list(), /MEDIA_LIBRARY_READ_FAILED/)
  const source = path.join(directory, 'video.mp4'); await fs.writeFile(source, 'video')
  await assert.rejects(library.add([source]), /MEDIA_LIBRARY_READ_FAILED/)
  assert.equal(await fs.readFile(saved, 'utf8'), raw)
  const valid = new MediaLibrary(path.join(directory, 'new.json'))
  for (const paths of [['relative.mp4'], ['C:\\bad\0.mp4'], Array(10001).fill(source)]) await assert.rejects(valid.add(paths), /MEDIA_LIBRARY_INVALID_PATH/)
}))

test('1200-file libraries import with bounded concurrency and open without scanning offline or hidden files', { timeout: 20000 }, () => fixture(async (directory, saved) => {
  const files = Array.from({ length: 1200 }, (_, index) => path.join(directory, `track-${index}.mp3`))
  for (let offset = 0; offset < files.length; offset += 64) await Promise.all(files.slice(offset, offset + 64).map(file => fs.writeFile(file, 'source sentinel')))
  const originalStat = fs.stat, sources = new Set(files)
  let reads = 0, active = 0, peak = 0
  fs.stat = async function(file, ...args) {
    if (!sources.has(file)) return originalStat.call(this, file, ...args)
    reads++; active++; peak = Math.max(peak, active)
    try { await new Promise(resolve => setTimeout(resolve, 3)); return await originalStat.call(this, file, ...args) }
    finally { active-- }
  }
  try {
    const library = new MediaLibrary(saved), start = performance.now(), imported = await library.add(files)
    const importMs = performance.now() - start
    assert.equal(imported.added, 1200); assert.equal(reads, 1200, 'Do not rescan the library after validating imports')
    assert.ok(peak > 1 && peak <= 32, 'Concurrent source checks must be bounded')
    const restored = new MediaLibrary(saved)
    reads = 0
    const opened = performance.now(), catalog = await restored.catalog(), openMs = performance.now() - opened
    assert.equal(catalog.length, 1200); assert.equal(reads, 0, 'Opening must read saved metadata, never all source files')
    const inspect = restored.inspectFile
    let unblock, started
    const gate = new Promise(resolve => { unblock = resolve }), checking = new Promise(resolve => { started = resolve })
    restored.inspectFile = async function(file) { started(); await gate; return inspect.call(this, file) }
    const slowCheck = restored.check([catalog[10].id]); await checking
    try {
      let timer
      try {
        await Promise.race([restored.catalog(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Slow drives blocked the saved catalog')), 750) })])
        assert.equal((await restored.get(catalog[11].id, false)).id, catalog[11].id, 'Cached artwork metadata must remain accessible during a slow page check')
      } finally { clearTimeout(timer) }
    } finally { unblock(); await slowCheck; restored.inspectFile = inspect; reads = 0 }
    await fs.unlink(files[0]); await fs.unlink(files[1199])
    const page = await restored.check(catalog.slice(0, 4).map(item => item.id))
    assert.equal(reads, 4); assert.equal(page[0].availability, 'missing')
    assert.equal((await restored.catalog())[0].availability, 'missing', 'Retain known status between visits')
    await assert.rejects(restored.play(catalog[1199].id), /MEDIA_LIBRARY_MISSING/, 'Playback must revalidate even an unchecked hidden file')
    reads = 0
    await restored.remove(catalog[1].id)
    assert.equal(reads, 0, 'Removing one reference must not rescan unrelated files')
    await assert.rejects(restored.check(Array(33).fill(catalog[0].id)), /MEDIA_LIBRARY_INVALID/)
    const fullScan = performance.now(); await restored.list(); const scanMs = performance.now() - fullScan
    console.log(`1200 files: import ${importMs.toFixed(1)} ms, saved catalog ${openMs.toFixed(1)} ms, full source scan ${scanMs.toFixed(1)} ms; peak checks ${peak}`)
    assert.equal(await fs.readFile(files[1], 'utf8'), 'source sentinel')
  } finally { fs.stat = originalStat }
}))
