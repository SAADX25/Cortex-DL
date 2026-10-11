require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const Module = require('node:module'), originalLoad = Module._load
let userData, selection = { canceled: true, filePaths: [] }, dialogOptions
const handlers = new Map(), fakeWindow = {}
Module._load = function(request, ...args) {
  if (request === '../engineReadiness') return { engineReceipts: { ensure: async () => ({ available: true }) } }
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
    for (const [name, args] of [['list', ['extra']], ['add', [['relative.mp4']]], ['add', [Array(501).fill(file)]], ['remove', ['../private']], ['play', ['valid', true]], ['thumbnail', [file]], ['artwork-select', ['../private']], ['artwork-select', ['valid', picture]], ['artwork-remove', []], ['unknown', []]]) assert.throws(() => validateIpcArguments('cortexdl:library:' + name, args))
    assert.deepEqual(await invoke('remove', item.id), [])
    assert.equal(await isLibraryMediaPath(file, await fs.realpath(file)), false)
    assert.equal(await invoke('thumbnail', item.id), null)
    assert.equal(await fs.readFile(file, 'utf8'), 'video')
    await assert.rejects(invoke('play', item.id), /MEDIA_LIBRARY_NOT_FOUND/)
  } finally { await fs.rm(userData, { recursive: true, force: true }) }
})
