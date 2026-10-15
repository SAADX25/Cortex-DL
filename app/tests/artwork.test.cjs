const { suite } = require('./register-ts.cjs')

suite('Embedded covers', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { execFileSync } = require('node:child_process')
  const { AudioArtwork } = require('../Back-End/electron/services/artworkService.ts')
  const { MediaLibrary } = require('../Back-End/electron/mediaLibrary.ts')
  const binary = name => path.resolve(__dirname, '../engine-baseline/' + name + '.exe')
  const run = (name, args) => execFileSync(binary(name), args, { windowsHide: true, timeout: 20000 }).toString()
  const probe = file => JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]))
  const pcm = file => run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-'])
  const art = color => execFileSync(binary('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=' + color + ':size=120x120', '-frames:v', '1', '-c:v', 'mjpeg', '-f', 'image2pipe', '-'], { windowsHide: true, timeout: 10000 })
  async function fixture(run) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-embedded-art-'))
    const editor = new AudioArtwork(async name => binary(name), async () => {})
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

  test('shell refresh follows committed cover replacement and removal; failed writes do not notify and refresh failures do not undo saved covers', () => fixture(async (dir) => {
    const file = path.join(dir, 'أغنية refresh.mp3'); make(file)
    const notifications = [], playerNotifications = [], image = art('blue')
    let committed = false, failRefresh = false
    const editor = new AudioArtwork(async name => binary(name), async source => {
      assert.equal(committed, true, 'Library persistence must finish before notifying other apps')
      assert.equal(source, await fs.realpath(file))
      assert.ok(!(await fs.readdir(dir)).some(name => name.startsWith('.cortex-cover-')), 'Temporary files must be cleaned before notifying')
      notifications.push(source)
      if (failRefresh) throw new Error('Shell unavailable')
    }, async (source, metadata) => {
      assert.equal(committed, true)
      assert.equal(source, await fs.realpath(file))
      playerNotifications.push(source)
      assert.equal(metadata.title, 'أغنية اختبار'); assert.equal(metadata.artist, 'Test artist'); assert.equal(metadata.album, 'Test album')
      assert.equal(metadata.attachmentCount, 1, 'Cache matching must use the original cover metadata, even after removal')
    })
    try {
      await editor.write(file, image, async () => { committed = true })
      assert.equal(notifications.length, 1)
      assert.equal(playerNotifications.length, 0, 'Legacy edits must not close an external player')
      const saved = await fs.readFile(file)
      committed = false
      await assert.rejects(editor.write(file, null, async () => { throw new Error('Persistence failed') }, true), /WRITE_FAILED/)
      assert.equal(notifications.length, 1, 'Rolled back edits must not send a success notification')
      assert.equal(playerNotifications.length, 0, 'Failed edits must not touch the external player')
      assert.deepEqual(await fs.readFile(file), saved)
      await editor.write(file, null, async () => { committed = true }, true)
      assert.equal(notifications.length, 2, 'Removing an embedded cover also refreshes the file')
      assert.equal(playerNotifications.length, 1, 'Explicitly enabled edits refresh the player cache')
      assert.equal(await editor.coverStream(file), null)
      failRefresh = true
      await editor.write(file, image, async () => { committed = true })
      assert.equal(notifications.length, 3)
      assert.notEqual(await editor.coverStream(file), null, 'A refresh failure must not roll back the cover')
    } finally { await editor.stop() }
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
})

suite('Shell refresh', test => {
  const assert = require('node:assert/strict'), path = require('node:path')
  const Module = require('node:module'), originalLoad = Module._load
  const calls = []
  let failure = null
  Module._load = function(request, ...args) {
    if (request === 'node:child_process') return {
      execFile: (binary, args, options, callback) => { calls.push({ binary, args, options }); callback(failure) },
    }
    return originalLoad.call(this, request, ...args)
  }
  const { refreshArtworkFile } = require('../Back-End/electron/services/artworkService.ts')
  Module._load = originalLoad

  test('Windows artwork refresh sends a bounded per-file Unicode notification without executing filenames', async () => {
    const file = path.resolve('غلاف $([dangerous]) `quoted` & name.mp3')
    const refreshed = await refreshArtworkFile(file)
    if (process.platform !== 'win32') {
      assert.equal(refreshed, false); assert.equal(calls.length, 0); return
    }
    assert.equal(refreshed, true)
    const { binary, args, options } = calls.at(-1)
    assert.equal(binary, path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    assert.deepEqual(args.slice(0, -1), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
    assert.ok(!script.includes(file)); assert.ok(!args.includes(file))
    assert.match(script, /CharSet = CharSet.Unicode/)
    assert.match(script, /SHChangeNotify\(0x00002000, 0x00002005, \$env:CORTEX_ARTWORK_FILE, \[IntPtr\]::Zero\)/)
    assert.equal(options.env.CORTEX_ARTWORK_FILE, file)
    assert.equal(options.windowsHide, true); assert.equal(options.timeout, 5000); assert.equal(options.maxBuffer, 8192)
    assert.ok(!options.shell)
    const count = calls.length
    assert.equal(await refreshArtworkFile('relative.mp3'), false)
    assert.equal(await refreshArtworkFile(file + '\0'), false)
    assert.equal(calls.length, count)
    failure = new Error('PowerShell is blocked')
    assert.equal(await refreshArtworkFile(file), false, 'Refresh is optional when PowerShell fails or times out')
  })
})

suite('VLC cache', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { pathToFileURL } = require('node:url')
  const { vlcArtworkMetadata, vlcArtworkDirectories, refreshVlcArtwork } = require('../Back-End/electron/services/artworkService.ts')

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

  test('external player refresh still updates VLC when Windows cache is unavailable', () => fixture(async ({ appData, song, metadata, image }) => {
    const savedAppData = process.env.APPDATA, savedLocalData = process.env.LOCALAPPDATA
    process.env.APPDATA = appData
    process.env.LOCALAPPDATA = path.join(appData, 'missing-windows-cache')
    try {
      const { refreshExternalPlayerArtwork } = require('../Back-End/electron/services/artworkService.ts')
      await refreshExternalPlayerArtwork(song, metadata)
      await assert.rejects(fs.stat(image), { code: 'ENOENT' })
    } finally {
      if (savedAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = savedAppData
      if (savedLocalData === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = savedLocalData
    }
  }))
})

suite('Windows player cache', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const Module = require('node:module'), originalLoad = Module._load
  const nativeCalls = []
  Module._load = function(request, ...args) {
    if (request === 'node:child_process') return { execFile: (binary, args, options, callback) => { nativeCalls.push({ binary, args, options }); callback(null) } }
    return originalLoad.call(this, request, ...args)
  }
  const { windowsPlayerArtworkPrefixes, refreshWindowsPlayerArtwork, closeWindowsMediaPlayer } = require('../Back-End/electron/services/artworkService.ts')
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
})

suite('Artwork preferences', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { spawn } = require('node:child_process')

  test('Windows artwork setting persists, switches Arabic layout and passes explicit refresh consent for every cover action', { timeout: 25000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-windows-artwork-ui-')), root = path.resolve(__dirname, '..')
    try {
      require('esbuild').buildSync({ stdin: { contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import SettingsTab from './Front-End/src/components/SettingsTab';
        import {useSettingsStore} from './Front-End/src/stores/useSettingsStore';
        import {useMediaLibraryStore} from './Front-End/src/stores/useMediaLibraryStore';
        import './Front-End/src/App.css';
        const calls=[];
        window.cortexDl={selectMediaLibraryArtwork:async(id,flag)=>{calls.push(['select',flag]);return null},removeMediaLibraryArtwork:async(id,flag)=>{calls.push(['remove',flag]);return []},embedMediaLibraryArtwork:async(id,flag)=>{calls.push(['embed',flag]);return []}};
        window.fixture={calls:()=>calls,lang:lang=>useSettingsStore.setState({lang}),edit:async()=>{const s=useMediaLibraryStore.getState();await s.selectArtwork('song');await s.removeArtwork('song');await s.embedArtwork('song')}};
        function View(){const lang=useSettingsStore(s=>s.lang);return <div className="app-container" dir={lang==='ar'?'rtl':'ltr'}><main className="main-content"><SettingsTab/></main></div>}
        createRoot(document.getElementById('root')).render(<View/>);
      `, resolveDir: root, loader: 'jsx' }, bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"', __APP_VERSION__: '"test"', __BUILD_SHA__: '"test-build"' } })
      await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
      await fs.writeFile(path.join(directory, 'electron.cjs'), `
        const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
        app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
        app.whenReady().then(async()=>{
          const win=new BrowserWindow({show:false,width:1080,height:850,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}}),js=s=>win.webContents.executeJavaScript(s);
          win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)});
          const wait=async s=>{for(let n=0;n<60;n++){if(await js(s))return;await new Promise(r=>setTimeout(r,30))}throw Error('UI did not settle: '+s)};
          await win.loadFile(path.join(__dirname,'index.html'));await wait('!!document.querySelector("button[role=switch]")');
          assert.equal(await js('document.querySelector("button[role=switch]").getAttribute("aria-checked")'),'true');
          await js('window.fixture.edit()');assert.deepEqual(await js('window.fixture.calls()'),[['select',true],['remove',true],['embed',true]]);
          await js('document.querySelector("button[role=switch]").click()');await wait('document.querySelector("button[role=switch]").getAttribute("aria-checked")==="false"');
          assert.equal(await js('localStorage.getItem("cortex-refresh-windows-artwork")'),'false');
          await js('window.fixture.edit()');assert.deepEqual((await js('window.fixture.calls()')).slice(-3),[['select',false],['remove',false],['embed',false]]);
          await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await wait('!!document.querySelector("button[role=switch]")');assert.equal(await js('document.querySelector("button[role=switch]").getAttribute("aria-checked")'),'false');
          await js('window.fixture.lang("ar")');await wait('document.querySelector("button[role=switch]").getAttribute("aria-label").includes("تحديث")');
          await js('document.querySelector("button[role=switch]").scrollIntoView({block:"center",behavior:"instant"})');
          assert.equal(await js('document.querySelector(".app-container").dir'),'rtl');
          assert.equal(await js('document.documentElement.scrollWidth<=window.innerWidth'),true);
          if(process.env.CORTEX_ARTWORK_CAPTURE){await new Promise(r=>setTimeout(r,200));fs.writeFileSync(process.env.CORTEX_ARTWORK_CAPTURE,(await win.webContents.capturePage()).toPNG())}
          win.destroy();app.quit();
        }).catch(error=>{console.error(error);app.exit(1)});
      `)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
        const timer = setTimeout(() => { child.kill(); reject(new Error('Windows artwork UI timed out: ' + output)) }, 20000)
        child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
      })
      assert.equal(result.code, 0, result.output)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})
