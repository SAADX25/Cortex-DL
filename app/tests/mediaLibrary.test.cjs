const { suite } = require('./register-ts.cjs')

suite('Library catalog', test => {
  const assert = require('node:assert/strict')
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

  test('mixed imports isolate inaccessible and disconnected sources and rapid repeats retain durable successes', () => fixture(async (directory, saved) => {
    const good = path.join(directory, 'good.mp3'), denied = path.join(directory, 'denied.wav'), disconnected = path.join(directory, 'offline.mp4')
    await Promise.all([good, denied, disconnected].map(file => fs.writeFile(file, 'unchanged')))
    const access = fs.access, stat = fs.stat
    fs.access = async (file, ...args) => { if (file === denied) throw Object.assign(Error('Denied'), { code: 'EACCES' }); return access(file, ...args) }
    fs.stat = async (file, ...args) => {
      if (file === disconnected) { await new Promise(resolve => setTimeout(resolve, 20)); throw Object.assign(Error('Disconnected'), { code: 'ENODEV' }) }
      return stat(file, ...args)
    }
    try {
      const library = new MediaLibrary(saved), batch = [good, denied, disconnected]
      const results = await Promise.all([library.add(batch), library.add(batch), library.add(batch)])
      assert.deepEqual(results.map(result => result.added), [1, 0, 0])
      assert.deepEqual(results.map(result => result.duplicates), [0, 1, 1])
      for (const result of results) {
        assert.deepEqual(result.rejected.map(item => item.reason), ['unreadable', 'unreadable'])
        assert.equal(result.items.length, 1)
      }
      assert.equal((await new MediaLibrary(saved).catalog())[0].filePath, good)
      assert.equal((await library.play(results[0].items[0].id)).availability, 'available', 'Playback must work immediately without any thumbnail')
      assert.deepEqual(await Promise.all(batch.map(file => fs.readFile(file, 'utf8'))), ['unchanged', 'unchanged', 'unchanged'])
    } finally { fs.access = access; fs.stat = stat }
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
})

suite('Library IPC', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const Module = require('node:module'), originalLoad = Module._load
  let userData, selection = { canceled: true, filePaths: [] }, dialogOptions
  const handlers = new Map(), fakeWindow = {}
  Module._load = function(request, ...args) {
    if (request.endsWith('/engineManager')) return { engineReceipts: { ensure: async () => ({ available: true }) } }
    if (request === '../paths') return { getBinaryPath: name => path.resolve(__dirname, '../engine-baseline/' + name + '.exe') }
    if (request === 'electron') return {
      app: { getPath: () => userData }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      dialog: { showOpenDialog: async (win, options) => { assert.equal(win, fakeWindow); dialogOptions = options; return selection } },
    }
    return originalLoad.call(this, request, ...args)
  }
  const { registerMediaLibraryIpc, isLibraryMediaPath } = require('../Back-End/electron/ipc/mediaLibraryIpc.ts')
  const { validateIpcArguments } = require('../Back-End/electron/ipcSecurity.ts')
  Module._load = originalLoad
  test('library IPC validates bounded arguments, handles native dialog cancellation and opens only registered media', async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-library-ipc-'))
    try {
      const file = path.join(userData, 'sample.mp4'); await fs.writeFile(file, 'video')
      registerMediaLibraryIpc(() => fakeWindow)
      const invoke = (name, ...args) => { const channel = 'cortexdl:library:' + name; validateIpcArguments(channel, args); return handlers.get(channel)({}, ...args) }
      assert.equal(await invoke('select'), null); assert.deepEqual(await invoke('list'), [])
      selection = { canceled: false, filePaths: [file] }
      const result = await invoke('select')
      assert.equal(result.added, 1); assert.ok(dialogOptions.properties.includes('multiSelections')); assert.ok(dialogOptions.filters[0].extensions.includes('flac'))
      const item = await invoke('play', result.items[0].id); assert.equal(item.filePath, file)
      assert.equal(await isLibraryMediaPath(file, await fs.realpath(file)), true, 'Streaming must use the same library as import/playback')
      selection = { canceled: true, filePaths: [] }; assert.equal(await invoke('relocate', item.id), null)
      assert.equal((await invoke('list')).length, 1)
      assert.equal((await invoke('check', [item.id]))[0].availability, 'available')
      await fs.rename(file, file + '.moved')
      assert.equal((await invoke('check', [item.id]))[0].availability, 'missing')
      await fs.rename(file + '.moved', file)
      await invoke('check', [item.id])
      assert.equal(await invoke('artwork-select', item.id), null, 'MP4 cover picker supports cancellation')
      const song = path.join(userData, 'song.mp3'), picture = path.join(userData, 'cover.png')
      const ffmpeg = path.resolve(__dirname, '../engine-baseline/ffmpeg.exe')
      require('node:child_process').execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.7', song], { windowsHide: true, timeout: 10000 })
      const audioHash = () => require('node:child_process').execFileSync(ffmpeg, ['-v', 'error', '-i', song, '-map', '0:a', '-f', 'hash', '-hash', 'sha256', '-'], { windowsHide: true, timeout: 10000 }).toString()
      const originalSound = audioHash()
      require('node:child_process').execFileSync(path.resolve(__dirname, '../engine-baseline/ffmpeg.exe'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:size=80x80', '-frames:v', '1', picture], { windowsHide: true, timeout: 10000 })
      const audio = (await invoke('add', [song])).items.find(entry => entry.kind === 'audio')
      const originalPicture = await fs.readFile(picture)
      const existing = path.join(userData, 'existing.mp3')
      require('node:child_process').execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', song, '-i', picture, '-map', '0:a', '-map', '1:v', '-c', 'copy', '-disposition:v', 'attached_pic', existing], { windowsHide: true, timeout: 10000 })
      const existingId = (await invoke('add', [existing])).items.find(entry => entry.filePath === existing).id
      const existingInfo = await invoke('artwork-info', existingId)
      assert.equal(existingInfo.embedded, true); assert.match(existingInfo.thumbnail, /^data:image\/jpeg/)
      const attached = path.join(userData, 'attached.mkv')
      require('node:child_process').execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=160x90:duration=0.3', '-c:v', 'libx264', '-preset', 'ultrafast', '-attach', picture, '-metadata:s:t:0', 'mimetype=image/png', attached], { windowsHide: true, timeout: 10000 })
      const attachedId = (await invoke('add', [attached])).items.find(entry => entry.filePath === attached).id
      const attachedInfo = await invoke('artwork-info', attachedId)
      assert.equal(attachedInfo.embedded, true, 'Non-editable video formats must retain attached-cover discovery')
      assert.match(attachedInfo.thumbnail, /^data:image\/jpeg/)
      await invoke('remove', attachedId)
      assert.equal((await invoke('list')).find(entry => entry.id === existingId).artwork, undefined, 'Detect covers already in files without copying them into custom storage')
      await invoke('artwork-remove', existingId)
      assert.equal((await invoke('artwork-info', existingId)).embedded, false, 'Removing a preexisting cover must strip it from the source file')
      await invoke('remove', existingId)
      assert.deepEqual(await fs.readFile(picture), originalPicture)
      assert.equal(await invoke('artwork-select', audio.id), null, 'Canceled image selection must not change metadata')
      selection = { canceled: false, filePaths: [picture] }
      const covered = await invoke('artwork-select', audio.id)
      assert.ok(covered.find(entry => entry.id === audio.id).artwork)
      assert.equal(covered.find(entry => entry.id === audio.id).artworkEmbedded, true)
      const { AudioArtwork } = require('../Back-End/electron/services/artworkService.ts'), originalProbe = AudioArtwork.prototype.coverStream
      let probes = 0, sourceReads = 0
      const originalStat = fs.stat
      fs.stat = async function(file, ...args) { if (file === song) sourceReads++; return originalStat.call(this, file, ...args) }
      AudioArtwork.prototype.coverStream = async () => { probes++; throw Error('Engine unavailable') }
      try {
        const info = await invoke('artwork-info', audio.id)
        assert.match(info.thumbnail, /^data:image\/jpeg/); assert.equal(info.embedded, true)
        assert.equal(probes, 0, 'Saved covers must display immediately without ffprobe or engine readiness')
        assert.equal(sourceReads, 0, 'Saved covers must not wait for a slow or offline source drive')
      } finally { AudioArtwork.prototype.coverStream = originalProbe; fs.stat = originalStat }
      const probe = () => JSON.parse(require('node:child_process').execFileSync(path.resolve(__dirname, '../engine-baseline/ffprobe.exe'), ['-v', 'error', '-show_streams', '-of', 'json', song], { windowsHide: true, timeout: 10000 }).toString())
      assert.equal(probe().streams.filter(stream => stream.disposition.attached_pic).length, 1, 'Picker must embed the cover in the actual MP3')
      assert.deepEqual(dialogOptions.properties, ['openFile']); assert.ok(dialogOptions.filters[0].extensions.includes('png'))
      await fs.unlink(picture)
      assert.match(await invoke('thumbnail', audio.id), /^data:image\/jpeg;base64,/, 'Cover copy must survive removal of the selected image')
      assert.equal((await invoke('artwork-embed', audio.id)).find(entry => entry.id === audio.id).artworkEmbedded, true, 'Stored artwork can be embedded without selecting the original image again')
      assert.equal((await invoke('artwork-remove', audio.id)).find(entry => entry.id === audio.id).artwork, undefined)
      await assert.rejects(invoke('artwork-embed', audio.id), /ARTWORK_INVALID/)
      assert.equal(probe().streams.filter(stream => stream.disposition.attached_pic).length, 0)
      await invoke('remove', audio.id)
      assert.equal(audioHash(), originalSound, 'Embedding and removing cover must preserve audio')
      for (const [name, args] of [['list', ['extra']], ['add', [['relative.mp4']]], ['add', [Array(10001).fill(file)]], ['check', [Array(33).fill('valid')]], ['check', [['../private']]], ['check', []], ['remove', ['../private']], ['play', ['valid', true]], ['thumbnail', [file]], ['artwork-select', ['../private']], ['artwork-select', ['valid', picture]], ['artwork-remove', []], ['unknown', []]]) assert.throws(() => validateIpcArguments('cortexdl:library:' + name, args))
      assert.deepEqual(await invoke('remove', item.id), [])
      assert.equal(await isLibraryMediaPath(file, await fs.realpath(file)), false)
      assert.equal(await invoke('thumbnail', item.id), null)
      assert.equal(await fs.readFile(file, 'utf8'), 'video')
      await assert.rejects(invoke('play', item.id), /MEDIA_LIBRARY_NOT_FOUND/)
    } finally { await fs.rm(userData, { recursive: true, force: true }) }
  })
})

suite('Preload boundary', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { spawn } = require('node:child_process')
  test('real sandboxed preload resolves native File paths and imports them through the protected library IPC', { timeout: 20000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-library-preload-'))
    try {
      const esbuild = require('esbuild'), root = path.resolve(__dirname, '..')
      for (const [source, output] of [['Back-End/electron/preload.ts', 'preload.cjs'], ['Back-End/electron/ipc/mediaLibraryIpc.ts', 'library.cjs'], ['Back-End/electron/ipcSecurity.ts', 'boundary.cjs']]) {
        esbuild.buildSync({ entryPoints: [path.join(root, source)], bundle: true, platform: 'node', external: ['electron'], format: 'cjs', outfile: path.join(directory, output) })
      }
      const source = path.join(directory, 'صوت local.WAV'); await fs.writeFile(source, 'untouched media')
      await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><body><input type="file" multiple></body></html>')
      await fs.writeFile(path.join(directory, 'electron.cjs'), `
        const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
        app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
        app.whenReady().then(async()=>{
          const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'preload.cjs')}});
          require('./boundary.cjs').installIpcBoundary(()=>win);require('./library.cjs').registerMediaLibraryIpc(()=>win);
          await win.loadFile(path.join(__dirname,'index.html'));
          win.webContents.debugger.attach('1.3');const send=(method,args)=>win.webContents.debugger.sendCommand(method,args);
          const document=await send('DOM.getDocument'),input=await send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'input'});
          const source=path.join(__dirname,'صوت local.WAV');await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[source]});
          const js=s=>win.webContents.executeJavaScript(s);
          assert.deepEqual(await js('window.cortexDl.getDroppedMediaPaths(Array.from(document.querySelector("input").files))'),[source]);
          assert.deepEqual(await js('window.cortexDl.getDroppedMediaPaths([new File(["text"],"artificial.mp4")])'),[]);
          const result=await js('window.cortexDl.addMediaLibraryFiles(window.cortexDl.getDroppedMediaPaths(Array.from(document.querySelector("input").files)))');
          assert.equal(result.added,1);assert.equal(result.items[0].kind,'audio');assert.equal(result.items[0].filePath,source);
          assert.equal((await js('window.cortexDl.listMediaLibrary()')).length,1);
          assert.equal((await js('window.cortexDl.checkMediaLibraryFiles(['+JSON.stringify(result.items[0].id)+'])'))[0].availability,'available');
          await assert.rejects(js('window.cortexDl.checkMediaLibraryFiles(["../unregistered"])'),/Invalid library items/);
          assert.equal((await js('window.cortexDl.removeMediaLibraryArtwork('+JSON.stringify(result.items[0].id)+')')).length,1);
          await assert.rejects(js('window.cortexDl.selectMediaLibraryArtwork("../unregistered")'),/Invalid library item/);
          await assert.rejects(js('window.cortexDl.embedMediaLibraryArtwork("../unregistered")'),/Invalid library item/);
          await assert.rejects(js('window.cortexDl.getMediaLibraryArtworkInfo("../unregistered")'),/Invalid library item/);
          await assert.rejects(js('window.cortexDl.embedMediaLibraryArtwork('+JSON.stringify(result.items[0].id)+')'),/ARTWORK_UNSUPPORTED/);
          await assert.rejects(js('window.cortexDl.addMediaLibraryFiles(["relative.mp4"])'),/Invalid library paths/);
          assert.equal(fs.readFileSync(source,'utf8'),'untouched media');
          win.webContents.debugger.detach();win.destroy();app.quit();
        }).catch(error=>{console.error(error);app.exit(1)});
      `)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
        const timer = setTimeout(() => { child.kill(); reject(new Error('Library preload timed out: ' + output)) }, 15000)
        child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
      })
      assert.equal(result.code, 0, result.output)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})

suite('Library interface', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { spawn, execFileSync } = require('node:child_process')

  test('media library UI imports, filters, plays, relocates, confirms removal and handles drops/errors with responsive Arabic layout', { timeout: 40000 }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-library-ui-'))
    try {
      const image = input => 'data:image/jpeg;base64,' + execFileSync(path.resolve(__dirname, '../engine-baseline/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', input, '-frames:v', '1', '-threads', '1', '-c:v', 'mjpeg', '-f', 'image2pipe', 'pipe:1'], { windowsHide: true, timeout: 10000 }).toString('base64')
      require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'fixtures/mediaLibrary.jsx')], bundle: true, outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"', __LIBRARY_VIDEO_ART__: JSON.stringify(image('testsrc2=size=320x180')), __LIBRARY_AUDIO_ART__: JSON.stringify(image('color=c=0x5b4091:size=180x180')) } })
      await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
      await fs.writeFile(path.join(directory, 'electron.cjs'), `
        const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
        app.disableHardwareAcceleration();app.setPath('userData',path.join(__dirname,'profile'));
        const delay=ms=>new Promise(r=>setTimeout(r,ms));
        app.whenReady().then(async()=>{
          const win=new BrowserWindow({show:false,width:1080,height:850,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}}),js=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){throw Error(s+': '+e.message)}};
          win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)});
          const wait=async s=>{for(let n=0;n<80;n++){if(await js(s))return;await delay(35)}throw Error('UI did not settle: '+s)};
          const capture=async name=>{if(process.env.CORTEX_LIBRARY_CAPTURE){await delay(150);fs.writeFileSync(path.join(process.env.CORTEX_LIBRARY_CAPTURE,name+'.png'),(await win.webContents.capturePage()).toPNG())}};
          const search=async value=>{await js('(()=>{const input=document.querySelector(".library-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(value)+');input.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(50)};
          await win.loadFile(path.join(__dirname,'index.html'));await wait('!!document.querySelector(".nav-item:nth-child(3)")');
          await js('document.querySelector(".nav-item:nth-child(3)").click()');await wait('!document.querySelector(".library-loading")');
          assert.equal(await js('document.querySelectorAll(".library-card").length'),0);assert.equal(await js('!!document.querySelector(".library-drop")'),true);await capture('library-empty');
          await js('window.fixture.canceled(true);document.querySelector(".library-header .library-add").click()');await delay(80);
          assert.equal(await js('document.querySelectorAll(".library-card").length'),0,'Canceled file picker must not change the library');
          await js('window.fixture.canceled(false);window.fixture.holdThumbnails();document.querySelector(".library-header .library-add").click()');await wait('document.querySelectorAll(".library-card").length===3');
          await wait('window.fixture.requests().thumbnails.length>0');
          assert.equal(await js('document.querySelectorAll(".library-thumbnail img").length'),0,'Cards must appear with placeholders before optional artwork resolves');
          assert.equal(await js('document.querySelector(".library-card .library-play").disabled'),false,'Background artwork must not disable playback');
          await js('window.fixture.releaseThumbnails()');await capture('library-en');
          assert.equal(await js('!!document.querySelector(".library-drop")'),false,'Populated library must not waste space on the drop banner');
          // Artwork loads only near the viewport; row heights vary with runner fonts/DPI.
          for(const selector of ['.library-card.video','.library-card.audio:not(.is-unavailable)']) {
            await js('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center",behavior:"instant"})');
            await wait('document.querySelector('+JSON.stringify(selector+' .library-thumbnail img')+')?.naturalWidth>0');
          }
          await js('document.querySelector(".main-content").scrollTop=0');
          const assertRows=async()=>{
            const rows=await js('Array.from(document.querySelectorAll(".library-card")).map(card=>{const r=card.getBoundingClientRect(),t=card.querySelector(".library-thumbnail").getBoundingClientRect(),b=card.querySelector(".library-card-details").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,imageRight:t.right,imageLeft:t.left,bodyLeft:b.left,bodyRight:b.right,rtl:document.querySelector(".media-library").dir==="rtl"}})');
            for(let i=0;i<rows.length;i++){
              const row=rows[i];assert.ok(row.width>row.height,'Library items must be horizontal rectangles: '+JSON.stringify(row));
              assert.ok(row.rtl?row.bodyRight<=row.imageLeft:row.imageRight<=row.bodyLeft,'Artwork must sit beside the details');
              if(i){assert.equal(row.left,rows[0].left);assert.equal(row.right,rows[0].right);assert.ok(row.top>=rows[i-1].bottom,'Library must use one row per file');}
            }
            assert.equal(await js('Array.from(document.querySelectorAll(".library-card button")).every(button=>{const b=button.getBoundingClientRect(),r=button.closest(".library-card").getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&b.bottom<=r.bottom})'),true,'Controls must fit inside each row');
          };
          await assertRows();
          await js('window.fixture.openAudioPlayer();document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").click()');
          await wait('!!document.querySelector(".library-notice.is-error")');assert.match(await js('document.querySelector(".library-notice.is-error").textContent'),/Close this file/);
          assert.deepEqual(await js('window.fixture.result().covers'),[],'An active media source must not be rewritten under the player');
          await js('window.fixture.closePlayer()');
          win.setContentSize(1600,850);await delay(150);await assertRows();await capture('library-wide-rows');
          win.setContentSize(1080,850);await delay(150);
          assert.equal(await js('document.querySelector(".is-unavailable .library-thumbnail img")'),null,'Missing artwork must retain the icon');
          assert.equal(await js('document.querySelector(".library-card.video .library-cover-button").textContent.includes("Add cover")'),true,'A generated video frame is not an embedded cover');
          assert.equal(await js('document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").textContent.includes("Change cover")'),true,'Existing embedded covers must be editable without adding a custom cover first');
          assert.ok(await js('!!document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-remove")'));
          await js('window.coverBefore=document.querySelector(".library-card.audio:not(.is-unavailable) img").src;window.fixture.canceled(true);document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").click()');await delay(80);
          assert.deepEqual(await js('window.fixture.result().covers'),[]);
          await js('window.fixture.canceled(false);window.fixture.artworkFailure(true);document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").click()');
          await wait('!!document.querySelector(".library-notice.is-error")');assert.match(await js('document.querySelector(".library-notice.is-error").textContent'),/8 MB/);
          assert.equal(await js('document.querySelector(".library-card.audio:not(.is-unavailable) img").src===window.coverBefore'),true);
          await js('window.fixture.artworkFailure(false);window.fixture.holdArtwork();document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").click()');
          await wait('!!document.querySelector(".library-card.audio:not(.is-unavailable) [role=progressbar]")');
          assert.equal(await js('document.querySelectorAll(".library-card [role=progressbar]").length'),1,'Progress must belong to the edited file');
          assert.equal(await js('document.querySelector(".library-card [role=progressbar]").hasAttribute("aria-valuenow")'),false,'Do not invent a percentage for file rewriting');
          await capture('library-cover-loading');
          await js('window.fixture.releaseArtwork()');
          await wait('document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").textContent.includes("Change cover")');
          await wait('document.querySelector(".library-card.audio:not(.is-unavailable) img").src!==window.coverBefore');
          assert.equal(await js('!!document.querySelector(".artwork-progress")'),false,'Progress must disappear when saving completes');
          assert.equal(await js('!!document.querySelector(".library-cover-embed")'),false,'New covers must be embedded immediately');
          assert.match(await js('document.querySelector(".library-cover-saved").textContent'),/saved to file/);
          await capture('library-custom-cover');
          await assertRows();
          await js('window.fixture.legacyCover()');await wait('!!document.querySelector(".library-cover-embed")');await assertRows();await capture('library-legacy-cover');
          await js('document.querySelector(".library-cover-embed").click()');await wait('!document.querySelector(".library-cover-embed")');
          assert.deepEqual(await js('window.fixture.result().embedded'),['audio']);
          assert.equal(await js('!!document.querySelector(".library-cover-saved")'),true);
          await js('window.fixture.refresh()');await delay(80);
          assert.ok(await js('!!document.querySelector(".library-cover-remove")'),'Refreshing must retain the assigned cover');
          await js('document.querySelector(".library-cover-remove").click()');await wait('!document.querySelector(".library-cover-remove")');
          assert.equal(await js('!!document.querySelector(".library-cover-saved")'),false);
          await wait('!document.querySelector(".library-card.audio:not(.is-unavailable) img")');
          assert.equal(await js('document.querySelector(".library-card.audio:not(.is-unavailable) .library-cover-button").textContent.includes("Add cover")'),true);
          await js('window.fixture.nativeVideoCover()');await wait('!!document.querySelector(".library-card.video .library-cover-remove")');
          assert.equal(await js('document.querySelector(".library-card.video .library-cover-button").textContent.includes("Change cover")'),true);
          await capture('library-existing-mp4-cover');
          await js('document.querySelector(".library-card.video .library-cover-remove").click()');await wait('!document.querySelector(".library-card.video .library-cover-remove")');
          await wait('document.querySelector(".library-card.video .library-cover-button").textContent.includes("Add cover")');
          await js('document.querySelector(".library-card.video .library-cover-button").click()');await wait('!!document.querySelector(".library-card.video .library-cover-remove")');
          await capture('library-changed-mp4-cover');
          await js('document.querySelector(".library-card.video .library-cover-remove").click()');await wait('!document.querySelector(".library-card.video .library-cover-remove")');
          assert.equal(await js('document.querySelector(".nav-item:nth-child(3)").getAttribute("aria-current")'),'page');
          await js('document.querySelectorAll(".library-filters button")[1].click()');await wait('document.querySelectorAll(".library-card").length===1');
          await js('document.querySelector(".library-play").click()');await wait('window.fixture.result().played.length===1');
          assert.equal(await js('window.fixture.result().player.filePath'),'C:/Videos/رحلة إلى عمّان.mp4');await js('window.fixture.closePlayer()');
          await js('document.querySelector(".library-card-actions button:nth-child(2)").click()');await wait('window.fixture.result().folders.length===1');
          await js('document.querySelector(".library-remove").click()');await wait('!!document.querySelector("[role=dialog]")');
          assert.match(await js('document.querySelector(".modal-body").textContent'),/file stays/);
          await js('document.querySelector(".modal-footer button:first-child").click()');await wait('!document.querySelector("[role=dialog]")');
          assert.deepEqual(await js('window.fixture.result().removed'),[]);
          await js('document.querySelector(".library-remove").click()');await wait('!!document.querySelector("[role=dialog]")');
          await js('document.querySelector(".modal-footer button:last-child").click()');await wait('window.fixture.result().removed.length===1');
          await js('document.querySelectorAll(".library-filters button")[0].click()');await wait('document.querySelectorAll(".library-card").length===2');
          await search('no-match');await wait('!!document.querySelector(".library-no-results")');
          await js('document.querySelector(".library-no-results button").click()');await wait('document.querySelectorAll(".library-card").length===2');
          await js('document.querySelector(".is-unavailable .library-play").click()');await wait('!document.querySelector(".is-unavailable")');
          await js('document.querySelector(".media-library").dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true,cancelable:true}))');
          assert.equal(await js('document.activeElement.classList.contains("library-search") || document.activeElement.parentElement.classList.contains("library-search")'),true);
          await js('(()=>{const data=new DataTransfer();data.items.add(new File(["audio"],"dropped.mp3"));data.items.add(new File(["exe"],"invalid.exe"));document.querySelector(".media-library").dispatchEvent(new DragEvent("drop",{dataTransfer:data,bubbles:true,cancelable:true}))})()');
          await wait('window.fixture.result().dropped.length===2');assert.deepEqual(await js('window.fixture.result().dropped'),['C:/Dropped/dropped.mp3','C:/Dropped/invalid.exe']);
          await wait('document.querySelector(".library-notice").textContent.includes("could not be added")');
          // A refresh that started before an import must never replace its newer snapshot.
          await js('window.fixture.holdRefresh();window.fixture.refresh();document.querySelector(".library-header .library-add").click()');await delay(100);
          await js('window.fixture.releaseRefresh()');await delay(100);assert.equal(await js('document.querySelectorAll(".library-card").length'),3);
          await js('window.fixture.failure(true);window.fixture.refresh()');await wait('!!document.querySelector(".library-notice.is-error")');
          assert.match(await js('document.querySelector(".library-notice.is-error").textContent'),/saved library/);
          await js('window.fixture.failure(false);window.fixture.restore()');await wait('document.querySelectorAll(".library-card").length===3');
          const selectSize=async size=>{await js('(()=>{const input=document.querySelector(".library-page-size select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(input,'+JSON.stringify(String(size))+');input.dispatchEvent(new Event("change",{bubbles:true}))})()');await delay(60)};
          await js('window.fixture.many()');await wait('document.querySelectorAll(".library-card").length===4');
          assert.equal(await js('document.querySelectorAll(".library-pagination").length'),1,'Library must have one set of page controls');
          await selectSize(8);await wait('document.querySelectorAll(".library-card").length===8');
          const assertSticky=async(offset=600)=>{
            await js('document.querySelector(".main-content").scrollTop='+offset);await delay(100);
            const bounds=await js('(()=>{const content=document.querySelector(".main-content"),viewport=content.getBoundingClientRect(),controls=document.querySelector(".library-controls").getBoundingClientRect();return {scroll:content.scrollTop,top:controls.top,viewportTop:viewport.top,bottom:controls.bottom,viewportBottom:viewport.bottom,visible:Array.from(document.querySelectorAll(".library-search,.library-filters,.library-pagination")).every(node=>{const r=node.getBoundingClientRect();return r.top>=viewport.top&&r.bottom<=viewport.bottom})}})()');
            assert.ok(bounds.scroll>100,'The media list must actually scroll');
            assert.ok(Math.abs(bounds.top-bounds.viewportTop)<1,'Controls must remain pinned at the top: '+JSON.stringify(bounds));
            assert.ok(bounds.visible,'Search, filters and pagination must remain visible while scrolling');
          };
          await assertSticky();await capture('library-sticky-scrolled');await assertSticky(100000);
          await search('Evening');await wait('document.querySelectorAll(".library-card").length===1');
          assert.equal(await js('document.querySelector(".library-page-number").textContent'),'Page 1 of 1','Search must work directly from the scrolled list');
          await search('');await wait('document.querySelectorAll(".library-card").length===8');
          await assertSticky();
          await js('document.querySelector(".library-page-next").click()');await wait('document.querySelectorAll(".library-card").length===1');await delay(300);
          assert.ok(await js('(()=>{const card=document.querySelector(".library-card").getBoundingClientRect(),controls=document.querySelector(".library-controls").getBoundingClientRect();return card.top>=controls.bottom-1&&card.top<innerHeight})()'),'Changing pages must reveal the new first file below the controls');
          await selectSize(2);await wait('document.querySelectorAll(".library-card").length===2');
          assert.equal(await js('document.querySelector(".library-pagination.top .library-page-number").textContent'),'Page 1 of 5');
          assert.equal(await js('document.querySelector(".library-pagination.top .library-page-previous").disabled'),true);
          const firstPage=await js('Array.from(document.querySelectorAll(".library-card h3")).map(item=>item.textContent)');
          await js('document.querySelector(".library-pagination.top .library-page-next").click()');await wait('document.querySelector(".library-pagination.top .library-page-number").textContent.includes("2 of 5")');
          assert.notDeepEqual(await js('Array.from(document.querySelectorAll(".library-card h3")).map(item=>item.textContent)'),firstPage);
          await search('Evening');await wait('document.querySelectorAll(".library-card").length===1');
          assert.equal(await js('document.querySelector(".library-page-number").textContent'),'Page 1 of 1');
          await search('');await wait('document.querySelectorAll(".library-card").length===2');
          for(let i=0;i<4;i++){await js('document.querySelector(".library-pagination.top .library-page-next").click()');await delay(40)}
          await wait('document.querySelector(".library-page-number").textContent.includes("5 of 5")');
          assert.equal(await js('document.querySelectorAll(".library-card").length'),1);
          assert.equal(await js('document.querySelector(".library-pagination.top .library-page-next").disabled'),true);
          await js('document.querySelector(".library-remove").click()');await wait('!!document.querySelector("[role=dialog]")');
          await js('document.querySelector(".modal-footer button:last-child").click()');await wait('document.querySelector(".library-page-number").textContent.includes("4 of 4")');
          assert.equal(await js('document.querySelectorAll(".library-card").length'),2,'Removing the last item of a page must clamp to the remaining last page');
          await js('document.querySelectorAll(".library-filters button")[2].click()');await wait('document.querySelectorAll(".library-card").length===2');
          assert.equal(await js('document.querySelector(".library-page-number").textContent'),'Page 1 of 4');
          await js('document.querySelectorAll(".library-filters button")[0].click()');await wait('document.querySelectorAll(".library-card").length===2');
          await js('document.querySelector(".library-search input").focus()');await delay(80);
          assert.equal(await js('getComputedStyle(document.querySelector(".library-search input")).outlineStyle'),'none','Focus must outline the whole search bar, not its inner input');
          assert.ok(await js('(()=>{const input=document.querySelector(".library-search input").getBoundingClientRect(),bar=document.querySelector(".library-search").getBoundingClientRect();return input.left>=bar.left&&input.right<=bar.right&&input.top>=bar.top&&input.bottom<=bar.bottom})()'));
          await capture('library-search-pagination');
          await selectSize(4);await js('window.fixture.restore()');await wait('document.querySelectorAll(".library-card").length===3');
          await js('window.fixture.language("ar");document.activeElement.blur();document.querySelector(".main-content").scrollTop=0');await wait('document.querySelector(".media-library").getAttribute("dir")==="rtl"');await assertRows();await capture('library-ar');
          win.setContentSize(650,850);await delay(150);await js('document.querySelector(".main-content").scrollTop=0');await capture('library-ar-narrow');
          await assertRows();
          const bounds=await js('(()=>{const r=document.querySelector(".media-library").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth}})()');
          assert.ok(bounds.left>=0&&bounds.right<=bounds.width,JSON.stringify(bounds));assert.equal(bounds.scroll,bounds.width,'Arabic library must not overflow');
          assert.match(await js('document.querySelector(".library-heading").textContent'),/مكتبة الوسائط/);
          await js('window.fixture.many()');await selectSize(12);await wait('document.querySelectorAll(".library-card").length===9');
          await assertSticky();await capture('library-sticky-ar-narrow');await assertSticky(100000);
          win.setContentSize(1080,850);await js('window.fixture.language("en")');await selectSize(4);
          const priorCount = await js('window.fixture.result().count');
          await js('window.fixture.holdImport();void window.fixture.importMany()');
          await wait('Array.from(document.querySelectorAll(".library-notice")).some(notice=>notice.textContent.includes("Adding 1,200 files"))');
          assert.equal(await js('Number(document.querySelector(".library-count").textContent)'),priorCount,'Pending imports must not publish uncommitted cards');
          await js('window.fixture.releaseImport()');await wait('!Array.from(document.querySelectorAll(".library-notice")).some(notice=>notice.textContent.includes("Adding"))');
          await js('window.fixture.resetRequests();window.fixture.holdCheck();window.fixture.large()');
          await wait('document.querySelector(".library-count").textContent==="1200"&&document.querySelectorAll(".library-card").length===4');
          await wait('window.fixture.requests().checks.length>0');
          assert.equal(await js('!!document.querySelector(".library-loading")'),false,'A slow availability check must not block the saved library');
          assert.equal(await js('document.querySelector(".library-page-number").textContent'),'Page 1 of 300');
          assert.ok((await js('window.fixture.requests().checks')).every(ids=>ids.length<=4),'Check only the current page in a 1200-file library');
          await js('window.fixture.releaseCheck();document.querySelector(".main-content").scrollTop=0');await delay(200);
          assert.ok(new Set(await js('window.fixture.requests().thumbnails')).size<=4,'Do not generate hidden-page thumbnails');
          await js('document.querySelector(".main-content").scrollTop=100000');await delay(100);
          await js('document.querySelector(".main-content").scrollTop=0');await wait('new Set(window.fixture.requests().thumbnails).size===4');
          const requests=await js('window.fixture.requests().thumbnails.length');
          await js('document.querySelector(".main-content").scrollTop=80');await delay(60);await js('document.querySelector(".main-content").scrollTop=0');await delay(60);
          assert.equal(await js('window.fixture.requests().thumbnails.length'),requests,'Scrolling must not request completed thumbnails again');
          await capture('library-1200-files');
          await js('window.fixture.resetRequests();document.querySelector(".library-page-next").click()');
          await wait('document.querySelector(".library-page-number").textContent.includes("2 of 300")&&window.fixture.requests().checks.length>0');
          assert.ok((await js('window.fixture.requests().checks')).every(ids=>ids.length===4&&ids.every(id=>!['large-1199','large-1198','large-1197','large-1196'].includes(id))),'Changing pages must validate the new page only');
          win.destroy();app.quit();
        }).catch(e=>{console.error(e);app.exit(1)});
      `)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [path.join(directory, 'electron.cjs')], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
        const timer = setTimeout(() => { child.kill(); reject(new Error('Library UI timed out: ' + output)) }, 35000)
        child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); resolve({ code, output }) })
      })
      assert.equal(result.code, 0, result.output)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})

suite('Thumbnails', test => {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { execFileSync } = require('node:child_process')
  const { LibraryThumbnails } = require('../Back-End/electron/services/thumbnailService.ts')
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
})

suite('Media information', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const os = require('node:os')
  const path = require('node:path')
  const { spawnSync } = require('node:child_process')
  const Module = require('node:module')
  const { parseFrameRate, videoFrameRate } = require('../Shared/frameRate.ts')
  let readiness = async () => {}
  let probeSpawns = 0
  const bin = name => path.resolve('engine-baseline', name + '.exe')
  const originalLoad = Module._load
  Module._load = function(request, ...args) {
    if (request.endsWith('/engineManager')) return { ensureEnginesReady: (...args) => readiness(...args), engineExecutionFailed() {} }
    if (request === './paths' || request === '../paths') return { getBinaryPath: name => { if (name === 'ffprobe') probeSpawns++; return bin(name) } }
    return originalLoad.call(this, request, ...args)
  }
  const { MediaProcessor } = require('../Back-End/electron/engines/MediaProcessor.ts')

  test('media FPS preserves fractional rates and rejects missing or invalid values', () => {
    assert.equal(parseFrameRate('30000/1001'), 30000 / 1001)
    assert.equal(parseFrameRate('60000/1001'), 60000 / 1001)
    assert.equal(parseFrameRate('29.97'), 29.97)
    assert.equal(parseFrameRate(60), 60)
    for (const invalid of [undefined, null, '', 'Unknown', '0/0', '30/0', '0/1', -30, Infinity, '1/2/3', '12junk', true]) assert.equal(parseFrameRate(invalid), null)
  })

  test('media FPS selects actual video, prefers the average and falls back to the nominal rate', () => {
    const streams = [
      { codec_type: 'audio', avg_frame_rate: '999/1' },
      { codec_type: 'video', disposition: { attached_pic: 1 }, avg_frame_rate: '1/1' },
      { codec_type: 'video', avg_frame_rate: '30000/1001', r_frame_rate: '60/1' },
    ]
    assert.equal(videoFrameRate(streams), 30000 / 1001)
    streams[2].avg_frame_rate = '0/0'
    assert.equal(videoFrameRate(streams), 60)
    assert.equal(videoFrameRate(streams.slice(0, 2)), null)
    assert.equal(videoFrameRate([{ codec_type: 'video', avg_frame_rate: '0/0', r_frame_rate: '0/0' }]), null)
  })

  test('media FPS probes a real portrait MP4 with a fractional rate and a path containing spaces and Arabic', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-fps العربية-'))
    try {
      const file = path.join(directory, 'portrait video.mp4')
      const result = spawnSync(bin('ffmpeg'), ['-y', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=576x1024:r=30000/1001', '-t', '0.4', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', file], { windowsHide: true, timeout: 15000 })
      assert.equal(result.status, 0, String(result.stderr || result.error))
      const processor = new MediaProcessor()
      assert.equal(await processor.getFps(file), 30000 / 1001)
      processor.killAll()
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  test('closing a media FPS request during readiness prevents a late native probe', async () => {
    let release
    readiness = () => new Promise(resolve => { release = resolve })
    const processor = new MediaProcessor()
    const before = probeSpawns
    try {
      const pending = processor.getFps('unused.mp4')
      processor.killAll()
      release()
      await assert.rejects(pending, { name: 'AbortError' })
      assert.equal(probeSpawns, before)
    } finally { readiness = async () => {} }
  })
})
