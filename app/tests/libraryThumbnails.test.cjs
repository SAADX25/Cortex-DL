require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { execFileSync } = require('node:child_process')
const { LibraryThumbnails } = require('../Back-End/electron/libraryThumbnails.ts')
const ffmpeg = path.resolve(__dirname, '../engine-baseline/ffmpeg.exe')
function media(args, output) { execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args, output], { windowsHide: true, timeout: 15000 }) }

test('manual artwork accepts any aspect ratio, normalizes real images and rejects oversized or invalid input', () => fixture(async directory => {
  const picture = path.join(directory, 'صورة طويلة.png'), invalid = path.join(directory, 'broken.jpg'), oversized = path.join(directory, 'huge.png')
  media(['-f', 'lavfi', '-i', 'color=c=purple:size=160x720', '-frames:v', '1'], picture)
  await fs.writeFile(invalid, 'not an image'); await fs.writeFile(oversized, Buffer.alloc(8 * 1024 * 1024 + 1))
  const original = await fs.readFile(picture), cache = new LibraryThumbnails(path.join(directory, 'cache'), async () => ffmpeg)
  try {
    const jpeg = await cache.prepareArtwork(picture)
    assert.equal(jpeg[0], 255); assert.equal(jpeg[1], 216); assert.ok(jpeg.length <= 1024 * 1024)
    assert.deepEqual(await fs.readFile(picture), original)
    await assert.rejects(cache.prepareArtwork(invalid), /ARTWORK_INVALID/)
    await assert.rejects(cache.prepareArtwork(oversized), /ARTWORK_INVALID/)
    await assert.rejects(cache.prepareArtwork(path.join(directory, 'absent.png')), /ARTWORK_INVALID/)
  } finally { await cache.stop() }
}))
const item = (filePath, kind) => ({ id: path.basename(filePath), filePath, kind, availability: 'available' })
async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-library-art-'))
  try { await run(directory) } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

test('library thumbnails extract real video frames and embedded audio covers, cache across restarts and preserve sources', () => fixture(async directory => {
  const video = path.join(directory, 'فيديو short.mp4'), cover = path.join(directory, 'art.jpg'), audio = path.join(directory, 'covered.mp3')
  media(['-f', 'lavfi', '-i', 'testsrc2=size=128x72:duration=0.4', '-c:v', 'libx264', '-preset', 'ultrafast'], video)
  media(['-f', 'lavfi', '-i', 'color=c=blue:size=100x100', '-frames:v', '1'], cover)
  media(['-f', 'lavfi', '-i', 'sine=duration=0.4', '-i', cover, '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-id3v2_version', '3'], audio)
  const before = await Promise.all([fs.readFile(video), fs.readFile(audio)])
  let starts = 0
  const cache = new LibraryThumbnails(path.join(directory, 'cache'), async () => { starts++; return ffmpeg })
  try {
    const results = await Promise.all([cache.get(item(video, 'video')), cache.get(item(video, 'video')), cache.get(item(audio, 'audio'))])
    results.forEach(result => assert.match(result, /^data:image\/jpeg;base64,/))
    assert.equal(results[0], results[1]); assert.equal(starts, 2, 'Concurrent requests for one source must share extraction')
    assert.notEqual(results[0], results[2]); assert.equal(await cache.get(item(video, 'video')), results[0]); assert.equal(starts, 2)
    const reopened = new LibraryThumbnails(path.join(directory, 'cache'), async () => { throw Error('Cached images must work without engines') })
    try { assert.equal(await reopened.get(item(audio, 'audio')), results[2]) } finally { await reopened.stop() }
    assert.deepEqual(await Promise.all([fs.readFile(video), fs.readFile(audio)]), before)
  } finally { await cache.stop() }
}))

test('artwork fallback uses nearby audio covers and invalidates missing or changed artwork without blocking media', () => fixture(async directory => {
  const audio = path.join(directory, 'no-cover.wav'), cover = path.join(directory, 'no-cover.jpg')
  media(['-f', 'lavfi', '-i', 'sine=duration=0.2'], audio)
  let calls = 0
  const cache = new LibraryThumbnails(path.join(directory, 'cache'), async () => { calls++; return ffmpeg })
  try {
    assert.equal(await cache.get(item(audio, 'audio')), null)
    assert.equal(await cache.get(item(audio, 'audio')), null); assert.equal(calls, 1, 'Missing art must be cached')
    media(['-f', 'lavfi', '-i', 'color=c=red:size=64x64', '-frames:v', '1'], cover)
    const red = await cache.get(item(audio, 'audio')); assert.match(red, /^data:image\/jpeg/)
    media(['-f', 'lavfi', '-i', 'color=c=green:size=80x80', '-frames:v', '1'], cover)
    const green = await cache.get(item(audio, 'audio')); assert.notEqual(green, red)
    await fs.unlink(audio); assert.equal(await cache.get(item(audio, 'audio')), null)
  } finally { await cache.stop() }
}))

test('unavailable thumbnail engines remain retryable and stopping drains queued work', () => fixture(async directory => {
  const video = path.join(directory, 'source.mp4'); media(['-f', 'lavfi', '-i', 'color=c=blue:size=64x64:duration=0.2', '-c:v', 'libx264'], video)
  let ready = false
  const cache = new LibraryThumbnails(path.join(directory, 'cache'), async () => { if (!ready) throw Error('Not ready'); return ffmpeg })
  assert.equal(await cache.get(item(video, 'video')), null)
  ready = true; assert.match(await cache.get(item(video, 'video')), /^data:image\/jpeg/)
  await cache.stop(); assert.equal(await cache.get(item(video, 'video')), null)
  const blocked = new LibraryThumbnails(path.join(directory, 'blocked'), async () => { await new Promise(resolve => setTimeout(resolve, 30)); return ffmpeg })
  const files = await Promise.all(Array.from({ length: 5 }, async (_, index) => { const file = path.join(directory, index + '.mp4'); await fs.copyFile(video, file); return file }))
  const requests = files.map(file => blocked.get(item(file, 'video')))
  await new Promise(resolve => setTimeout(resolve, 10)); await blocked.stop()
  assert.deepEqual(await Promise.all(requests), Array(5).fill(null))
}))

test('thumbnail cache remembers embedded discovery across restarts, deduplicates misses and repairs corrupt cache data', () => fixture(async directory => {
  const audio = path.join(directory, 'song.mp3'); await fs.writeFile(audio, 'read-only source sentinel')
  const image = Buffer.from([255, 216, ...Array(20).fill(1), 255, 217]), cacheDirectory = path.join(directory, 'cache')
  let probes = 0, extracts = 0
  const create = () => {
    const cache = new LibraryThumbnails(cacheDirectory, async () => 'unused', async () => { probes++; return 1 })
    cache.extract = async () => { extracts++; return image }
    return cache
  }
  const cache = create()
  try {
    const [first, duplicate] = await Promise.all([cache.getInfo(item(audio, 'audio')), cache.getInfo(item(audio, 'audio'))])
    assert.deepEqual(first, duplicate); assert.equal(first.embedded, true); assert.match(first.thumbnail, /^data:image\/jpeg/)
    assert.equal(probes, 1); assert.equal(extracts, 1)
    await cache.stop()
    const reopened = create()
    try {
      assert.deepEqual(await reopened.getInfo(item(audio, 'audio')), first)
      assert.equal(probes, 1, 'A cache hit after restart must not launch discovery'); assert.equal(extracts, 1)
      const files = await fs.readdir(cacheDirectory), jpeg = files.find(name => name.endsWith('.jpg')), info = files.find(name => name.endsWith('.info'))
      await fs.writeFile(path.join(cacheDirectory, info), '{bad metadata')
      assert.deepEqual(await reopened.getInfo(item(audio, 'audio')), first)
      assert.equal(probes, 2); assert.equal(extracts, 1, 'Legacy/corrupt metadata can be repaired without decoding a valid image')
      await fs.writeFile(path.join(cacheDirectory, jpeg), 'not a JPEG')
      assert.deepEqual(await reopened.getInfo(item(audio, 'audio')), first)
      assert.equal(extracts, 2, 'A corrupt JPEG must be regenerated')
      await fs.utimes(audio, new Date(), new Date(Date.now() + 10000))
      assert.equal((await reopened.getInfo(item(audio, 'audio'))).embedded, true)
      assert.equal(extracts, 3, 'Source changes must invalidate image and embedded metadata together')
      assert.equal(await fs.readFile(audio, 'utf8'), 'read-only source sentinel')
    } finally { await reopened.stop() }
  } finally { await cache.stop() }
}))

test('discovery and extraction share two worker slots, failed discovery retries and shutdown drains waiting discoveries', () => fixture(async directory => {
  const files = Array.from({ length: 5 }, (_, i) => path.join(directory, i + '.mp3'))
  await Promise.all(files.map(file => fs.writeFile(file, 'source')))
  let active = 0, peak = 0, probes = 0
  const cache = new LibraryThumbnails(path.join(directory, 'cache'), async () => 'unused', async () => {
    probes++; active++; peak = Math.max(peak, active)
    try { await new Promise(resolve => setTimeout(resolve, 10)); return null } finally { active-- }
  })
  cache.extract = async () => {
    active++; peak = Math.max(peak, active)
    try { await new Promise(resolve => setTimeout(resolve, 10)); return null } finally { active-- }
  }
  try {
    const results = await Promise.all(files.map(file => cache.getInfo(item(file, 'audio'))))
    assert.ok(results.every(info => info.thumbnail === null && !info.embedded)); assert.equal(peak, 2)
    await cache.getInfo(item(files[0], 'audio')); assert.equal(probes, 5, 'Negative cache hits must skip discovery too')
  } finally { await cache.stop() }
  let ready = false, attempts = 0
  const retry = new LibraryThumbnails(path.join(directory, 'retry'), async () => 'unused', async () => { attempts++; if (!ready) throw Error('Missing ffprobe'); return 1 })
  retry.extract = async () => null
  try {
    assert.equal((await retry.getInfo(item(files[0], 'audio'))).thumbnail, null)
    ready = true
    assert.equal((await retry.getInfo(item(files[0], 'audio'))).embedded, true); assert.equal(attempts, 2, 'Failed discovery must not publish a permanent negative cache')
    assert.equal((await retry.getInfo(item(files[0], 'audio'))).embedded, true, 'A failed image extraction must retain embedded-cover controls on cache hits')
  } finally { await retry.stop() }
  let started, release
  const entered = new Promise(resolve => { started = resolve }), gate = new Promise(resolve => { release = resolve })
  const stopped = new LibraryThumbnails(path.join(directory, 'stopped'), async () => 'unused', async () => { started(); await gate; return 1 })
  const pending = files.map(file => stopped.getInfo(item(file, 'audio')))
  await entered
  const stopping = stopped.stop(); release(); await stopping
  assert.ok((await Promise.all(pending)).every(info => info.thumbnail === null))
  assert.equal((await fs.readdir(path.join(directory, 'stopped'))).filter(name => /\.(jpg|none|info)$/.test(name)).length, 0)
}))
