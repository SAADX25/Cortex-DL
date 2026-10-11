require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { execFileSync } = require('node:child_process')
const { AudioArtwork } = require('../Back-End/electron/audioArtwork.ts')
const { MediaLibrary } = require('../Back-End/electron/mediaLibrary.ts')
const binary = name => path.resolve(__dirname, '../engine-baseline/' + name + '.exe')
const run = (name, args) => execFileSync(binary(name), args, { windowsHide: true, timeout: 20000 }).toString()
const probe = file => JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]))
const pcm = file => run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-'])
const art = color => execFileSync(binary('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=' + color + ':size=120x120', '-frames:v', '1', '-c:v', 'mjpeg', '-f', 'image2pipe', '-'], { windowsHide: true, timeout: 10000 })
async function fixture(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-embedded-art-'))
  const editor = new AudioArtwork(async name => binary(name))
  try { await run(dir, editor) } finally { await editor.stop(); await fs.rm(dir, { recursive: true, force: true }) }
}
const make = file => run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=480:duration=1.2', '-metadata', 'title=أغنية اختبار', '-metadata', 'artist=Test artist', '-metadata', 'album=Test album', '-metadata', 'track=7', file])

test('MP4 artwork replacement and removal preserve video, audio, subtitles and chapters', () => fixture(async (dir, editor) => {
  const file = path.join(dir, 'فيديو with captions.mp4'), captions = path.join(dir, 'captions.srt'), metadata = path.join(dir, 'chapters.txt')
  await fs.writeFile(captions, '1\n00:00:00,000 --> 00:00:01,000\nترجمة محفوظة\n')
  await fs.writeFile(metadata, ';FFMETADATA1\ntitle=Test video\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1100\ntitle=Opening\n')
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:duration=1.2', '-f', 'lavfi', '-i', 'sine=duration=1.2', '-i', captions, '-i', metadata,
    '-map', '0:v', '-map', '1:a', '-map', '2:s', '-map_metadata', '3', '-map_chapters', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=ara', file])
  const original = probe(file), sound = pcm(file), frames = run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-'])
  const subtitle = run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:s:0', '-f', 'srt', '-'])
  const chapter = () => JSON.parse(run('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file])).chapters
  const chapters = chapter(), red = art('red'), blue = art('blue')
  assert.equal(await editor.coverStream(file), null)
  const library = new MediaLibrary(path.join(dir, 'library.json')), id = (await library.add([file])).items[0].id
  for (const image of [red, blue, null]) {
    await library.setArtwork(id, image, (file, persist) => editor.write(file, image, () => persist(true)))
    const after = probe(file), attached = after.streams.filter(stream => stream.disposition.attached_pic)
    assert.equal(attached.length, image ? 1 : 0)
    assert.equal(pcm(file), sound); assert.equal(run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-']), frames)
    assert.equal(run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:s:0', '-f', 'srt', '-']), subtitle)
    assert.equal(after.streams.find(stream => stream.codec_type === 'subtitle').tags.language, 'ara')
    const chapterValues = values => values.map(({ start_time, end_time, tags }) => ({ start_time, end_time, tags }))
    assert.equal(after.format.tags.title, original.format.tags.title); assert.deepEqual(chapterValues(chapter()), chapterValues(chapters))
    const stream = await editor.coverStream(file)
    assert.equal(stream !== null, !!image, 'Cover detection must invalidate cached results when a file changes')
    if (image) assert.deepEqual(execFileSync(binary('ffmpeg'), ['-v', 'error', '-i', file, '-map', '0:' + stream, '-c', 'copy', '-f', 'image2pipe', '-'], { windowsHide: true, timeout: 10000 }), image)
  }
  assert.ok(!(await fs.readdir(dir)).some(name => name.startsWith('.cortex-cover-')))
}))

for (const format of ['mp3', 'flac', 'm4a']) test(format + ' cover is embedded in the actual file, replaced and removed while audio and song tags survive', () => fixture(async (dir, editor) => {
  const file = path.join(dir, 'أغنية with spaces.' + format); make(file)
  const before = probe(file), sound = pcm(file), red = art('red'), blue = art('blue')
  const library = new MediaLibrary(path.join(dir, 'library.json')), id = (await library.add([file])).items[0].id
  const save = image => library.setArtwork(id, image, (file, persist) => editor.write(file, image, () => persist(true)))
  for (const image of [red, blue, null]) {
    await save(image)
    const after = probe(file), pictures = after.streams.filter(stream => stream.disposition.attached_pic)
    assert.equal(pictures.length, image ? 1 : 0)
    assert.equal(pcm(file), sound, 'Decoded audio samples must stay identical')
    for (const key of ['title', 'artist', 'album', 'track']) assert.equal(after.format.tags[key], before.format.tags[key], key + ' must survive')
    assert.equal((await library.list())[0].size, (await fs.stat(file)).size)
    assert.equal((await library.list())[0].artworkEmbedded, image ? true : undefined)
    if (image) {
      const embedded = execFileSync(binary('ffmpeg'), ['-v', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'image2pipe', '-'], { windowsHide: true, timeout: 10000 })
      assert.deepEqual(embedded, image, 'Actual attached artwork must match the selected cover')
      assert.deepEqual(await new MediaLibrary(path.join(dir, 'library.json')).getArtwork(id), image)
    }
  }
  assert.ok(!(await fs.readdir(dir)).some(name => name.startsWith('.cortex-cover-')), 'Successful edits must clean temporary files')
}))

test('embedded cover edit rolls back source bytes and library when saving metadata fails; invalid media remains untouched', () => fixture(async (dir, editor) => {
  const file = path.join(dir, 'original.mp3'), saved = path.join(dir, 'library.json'); make(file)
  const library = new MediaLibrary(saved), id = (await library.add([file])).items[0].id, original = await fs.readFile(file), image = art('red')
  await fs.rename(saved, saved + '.original'); await fs.mkdir(saved)
  await assert.rejects(library.setArtwork(id, image, (file, persist) => editor.write(file, image, persist)))
  assert.deepEqual(await fs.readFile(file), original, 'Failure after file promotion must restore the exact original bytes')
  assert.equal((await library.list())[0].artwork, undefined)
  assert.deepEqual(await fs.readdir(path.join(dir, 'library-artwork')), [])
  const invalid = path.join(dir, 'broken.mp3'); await fs.writeFile(invalid, 'not audio')
  await assert.rejects(editor.write(invalid, image, async () => assert.fail('Must not save invalid media')), /WRITE_FAILED/)
  assert.equal(await fs.readFile(invalid, 'utf8'), 'not audio')
  assert.ok(!(await fs.readdir(dir)).some(name => name.startsWith('.cortex-cover-')))
}))

test('external file changes, read-only files and shutdown cannot overwrite the source', () => fixture(async (dir, editor) => {
  const file = path.join(dir, 'source.mp3'); make(file)
  const image = art('blue'), original = await fs.readFile(file)
  await fs.chmod(file, 0o444)
  try { await assert.rejects(editor.write(file, image, async () => assert.fail('Must not persist read-only file')), /WRITE_FAILED/) }
  finally { await fs.chmod(file, 0o666) }
  assert.deepEqual(await fs.readFile(file), original)
  const changed = Buffer.concat([original, Buffer.from('external update')])
  const concurrent = new AudioArtwork(async name => {
    if (name === 'ffprobe') await fs.writeFile(file, changed)
    return binary(name)
  })
  try { await assert.rejects(concurrent.write(file, image, async () => assert.fail('Must not overwrite external edits')), /FILE_CHANGED/) }
  finally { await concurrent.stop() }
  assert.deepEqual(await fs.readFile(file), changed)
  let release, entered
  const ready = new Promise(resolve => { entered = resolve })
  const stopped = new AudioArtwork(async name => { entered(); await new Promise(resolve => { release = resolve }); return binary(name) })
  const work = stopped.write(file, image, async () => assert.fail('Stopped edit must not commit'))
  await ready; const shutdown = stopped.stop(); release()
  await assert.rejects(work, /WRITE_FAILED/); await shutdown
  assert.deepEqual(await fs.readFile(file), changed)
  assert.ok(!(await fs.readdir(dir)).some(name => name.startsWith('.cortex-cover-')))
}))
