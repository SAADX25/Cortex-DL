require('./register-ts.cjs')
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), Module = require('node:module')
const { spawnSync } = require('node:child_process')
const binary = name => path.resolve('engine-baseline', name + '.exe'), original = Module._load
let ensure = async () => {}
const handlers = new Map(), sender = new (require('node:events').EventEmitter)()
let dialogResult = { canceled: true }, task
Module._load = function(request, parent, ...rest) {
  if (request.endsWith('/engineReadiness')) return { ensureEnginesReady: (...args) => ensure(...args), engineExecutionFailed() {} }
  if (request.endsWith('/paths')) return { getBinaryPath: binary }
  if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
  if (request === 'electron') return { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: { showSaveDialog: async () => dialogResult } }
  return original.call(this, request, parent, ...rest)
}
const { listDownloadSubtitles, mergeDownloadSubtitle } = require('../Back-End/electron/subtitles/downloadMerge.ts')
const { registerDownloadSubtitleIpc } = require('../Back-End/electron/subtitles/downloadMergeIpc.ts')
const { validateIpcArguments } = require('../Back-End/electron/ipcSecurity.ts')
const { probeMediaFile } = require('../Back-End/electron/mediaFiles.ts')
const srt = '1\n00:00:00,200 --> 00:00:00,900\nترجمة عربية بتوقيت الصوت\n'
async function sandbox(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-merge-'))
  try { await fn(dir) } finally { ensure = async () => {}; await fs.rm(dir, { recursive: true, force: true }) }
}
function ffmpeg(args) {
  const result = spawnSync(binary('ffmpeg'), ['-v', 'error', ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.equal(result.status, 0, result.stderr); return result.stdout
}
test('sidecar discovery accepts matching timed SRT/VTT, with language, while ignoring unrelated and invalid files', () => sandbox(async dir => {
  const name = 'فيديو with spaces', media = path.join(dir, name + '.mp4')
  for (const [suffix, text] of [['.ar.srt', srt], ['.en.vtt', 'WEBVTT\n\n00:00.200 --> 00:00.900\nHello'], ['.srt', srt], ['.fr.srt', 'invalid'], ['.de.srt', ''], ['other.ar.srt', srt]]) await fs.writeFile(path.join(dir, suffix.startsWith('.') ? name + suffix : suffix), text)
  const found = await listDownloadSubtitles(media)
  assert.equal(found.length, 3); assert.equal(found.find(f => f.language === 'ar').label, 'Arabic'); assert.ok(found.some(f => f.language === 'und'))
  await assert.rejects(mergeDownloadSubtitle(media, '../other.ar.srt', path.join(dir, 'out.mp4'), 'mp4', new AbortController().signal), /SUBTITLE_FILE_UNAVAILABLE/)
}))
test('real MP4 and MKV contain timed Arabic with unchanged audio/video packets, codecs, FPS and resolution', () => sandbox(async dir => {
  const media = path.join(dir, 'original.mp4'), caption = 'original.ar.srt'
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30000/1001:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', media])
  await fs.writeFile(path.join(dir, caption), srt)
  const packets = file => ffmpeg(['-i', file, '-map', '0:v', '-map', '0:a', '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-']).split(/\r?\n/).filter(s => /^\d+,/.test(s)).join('\n')
  for (const format of ['mp4', 'mkv']) {
    const output = path.join(dir, 'out.' + format)
    await mergeDownloadSubtitle(media, caption, output, format, new AbortController().signal)
    const probe = await probeMediaFile(output), video = probe.streams.find(s => s.codec_type === 'video'), subtitle = probe.streams.find(s => s.codec_type === 'subtitle')
    assert.equal(video.width, 320); assert.equal(video.height, 180); assert.equal(video.avg_frame_rate, '30000/1001')
    assert.equal(subtitle.tags.language, 'ara'); assert.equal(subtitle.codec_name, format === 'mp4' ? 'mov_text' : 'subrip')
    assert.equal(packets(output), packets(media))
    const extracted = ffmpeg(['-i', output, '-map', '0:s:0', '-f', 'srt', '-'])
    assert.match(extracted, /ترجمة عربية بتوقيت الصوت/); assert.match(extracted, /00:00:00,200 --> 00:00:00,900/)
  }
  const english = path.join(dir, 'english.srt'), withEnglish = path.join(dir, 'bilingual.mp4')
  await fs.writeFile(english, '1\n00:00:00,200 --> 00:00:00,900\nOriginal English\n')
  ffmpeg(['-i', media, '-i', english, '-map', '0:v', '-map', '0:a', '-map', '1:s', '-c', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', withEnglish])
  await fs.writeFile(path.join(dir, 'bilingual.ar.srt'), srt)
  await mergeDownloadSubtitle(withEnglish, 'bilingual.ar.srt', path.join(dir, 'bilingual-out.mp4'), 'mp4', new AbortController().signal)
  assert.deepEqual((await probeMediaFile(path.join(dir, 'bilingual-out.mp4'))).streams.filter(s => s.codec_type === 'subtitle').map(s => s.tags.language), ['eng', 'ara'])
  await assert.rejects(mergeDownloadSubtitle(media, caption, media, 'mp4', new AbortController().signal), /CHOOSE_NEW/)
  const controller = new AbortController(); ensure = async () => controller.abort()
  const canceled = path.join(dir, 'canceled.mp4')
  await assert.rejects(mergeDownloadSubtitle(media, caption, canceled, 'mp4', controller.signal), /abort/i)
  assert.equal(await fs.stat(canceled).catch(() => null), null)
  assert.equal((await fs.readdir(dir)).some(name => name.startsWith('.cortex-merge-')), false)
}))
test('merge IPC requires a completed download and an offered sidecar, validates filenames and handles canceled Save dialog', () => sandbox(async dir => {
  task = { status: 'completed', filePath: path.join(dir, 'video.mp4') }
  await fs.writeFile(path.join(dir, 'video.ar.srt'), srt)
  registerDownloadSubtitleIpc({ getWin: () => ({}), getDownloads: () => ({ get: () => task }) })
  const list = handlers.get('cortexdl:subtitle-files:list'), merge = handlers.get('cortexdl:subtitle-files:merge')
  assert.equal((await list({}, 'task')).length, 1)
  task.status = 'downloading'; await assert.rejects(list({}, 'task'), /SELECT_COMPLETED/); task.status = 'completed'
  await assert.rejects(merge({ sender }, 'task', 'unrelated.srt', 'mp4'), /UNAVAILABLE/)
  assert.equal(await merge({ sender }, 'task', 'video.ar.srt', 'mp4'), null)
  assert.equal(sender.listenerCount('destroyed'), 0)
  for (const args of [['task', '../x.srt', 'mp4'], ['task', 'x.exe', 'mp4'], ['task', 'x.srt', 'avi'], ['task', 'x.srt']]) assert.throws(() => validateIpcArguments('cortexdl:subtitle-files:merge', args))
  validateIpcArguments('cortexdl:subtitle-files:merge', ['task', 'video.ar.srt', 'mp4'])
}))
