require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const originalLoad = Module._load
const dbMock = {
  db: { prepare: () => ({ get: () => undefined, run: () => {} }), transaction: fn => fn },
  taskDb: { getAllTasks: { all: () => [] }, upsertTask: { run: row => { dbMock.lastRow = row } }, deleteTask: { run: () => {} }, clearCompleted: { run: () => {} } },
}
Module._load = function (request, parent, ...rest) {
  if (request === 'electron-log') return { info: () => {}, warn: () => {}, error: () => {} }
  if (request === './db' || request === '../db') return dbMock
  if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir() }, Notification: { isSupported: () => false } }
  return originalLoad.call(this, request, parent, ...rest)
}
const { updateTaskProgress, getProgressView } = require('../Shared/progressModel.ts')
const { isSupportedMediaPath, probeMediaFile } = require('../Back-End/electron/mediaFiles.ts')
const { matchesAudioFormat } = require('../Back-End/electron/audioFormats.ts')
const { AUDIO_FORMATS } = require('../Shared/types.ts')
const { DirectEngine } = require('../Back-End/electron/engines/DirectEngine.ts')
const { DownloadManager } = require('../Back-End/electron/downloadManager.ts')
const { YoutubeEngine } = require('../Back-End/electron/engines/YoutubeEngine.ts')
const { throttledSendUpdate } = require('../Back-End/electron/utils.ts')
const { computeSpeed } = require('../Back-End/electron/utils.ts')
const { parseStateTransition, parseDownloadProgress } = require('../Back-End/electron/progressParser.ts')
const { runFfmpegDownload } = require('../Back-End/electron/ffmpegEngine.ts')

function task(overrides = {}) {
  return { id: '11111111-1111-4111-8111-111111111111', url: 'https://example.com/file', directory: '', filename: 'file.mp4', filePath: '', engine: 'direct', targetFormat: 'mp4', status: 'downloading', totalBytes: 100, downloadedBytes: 0, speedBytesPerSec: null, errorMessage: null, createdAtMs: 1, updatedAtMs: 1, ...overrides }
}
function runtime() { return { abortController: null, child: null, lastSpeedSampleAtMs: null, lastSpeedSampleBytes: null, lastIpcAtMs: 0, retries: 0 } }
function context(rt) { return { runtime: rt, sendUpdate: t => updateTaskProgress(t), saveState: () => {}, flushSave: () => {}, scheduleRetry: () => {}, sendStats: () => {}, sendYouTubeOAuthCode: () => {} } }

function server(body, ignoreRange = false, slow = false) {
  let rangeRequests = 0
  const instance = http.createServer((req, res) => {
    if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': body.length, 'accept-ranges': 'bytes' }); res.end(); return }
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
    if (match) rangeRequests++
    const start = match && !ignoreRange ? Number(match[1]) : 0
    const end = match && match[2] && !ignoreRange ? Number(match[2]) : body.length - 1
    const part = body.subarray(start, end + 1)
    res.writeHead(match && !ignoreRange ? 206 : 200, {
      'content-length': part.length,
      ...(match && !ignoreRange ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}),
    })
    if (!slow) { res.end(part); return }
    let offset = 0
    const timer = setInterval(() => {
      if (res.destroyed) { clearInterval(timer); return }
      const next = part.subarray(offset, offset + 32768)
      offset += next.length
      res.write(next)
      if (offset >= part.length) { clearInterval(timer); res.end() }
    }, 3)
  })
  return { instance, get rangeRequests() { return rangeRequests } }
}
async function withServer(body, ignoreRange, slow, fn) {
  const s = server(body, ignoreRange, slow)
  await new Promise(resolve => s.instance.listen(0, '127.0.0.1', resolve))
  try { await fn(`http://127.0.0.1:${s.instance.address().port}/file`, s) }
  finally { s.instance.closeAllConnections(); await new Promise(resolve => s.instance.close(resolve)) }
}

test('Direct backend progress reaches 100 in the shared view', () => {
  const t = task({ downloadedBytes: 100 })
  updateTaskProgress(t)
  assert.equal(t.overallProgress, 100)
  assert.deepEqual(getProgressView(t), getProgressView({ ...t }))
  assert.equal(getProgressView(t).percentLabel, '100%')
  t.status = 'error'
  updateTaskProgress(t)
  assert.equal(t.overallProgress, 99)
})
test('unknown-length progress is indeterminate and Direct speed uses byte delta', () => {
  const t = task({ totalBytes: null, downloadedBytes: 1024 })
  updateTaskProgress(t)
  assert.equal(getProgressView(t).isIndeterminate, true)
  const rt = runtime()
  rt.lastSpeedSampleAtMs = Date.now() - 1000
  rt.lastSpeedSampleBytes = 0
  computeSpeed(t, rt)
  assert.ok(t.speedBytesPerSec > 0)
})
test('YouTube video/audio progress stays monotonic and post-processing is truthful', () => {
  const t = task({ engine: 'ytdlp', ytdlpExpectedBytes: 200 })
  parseDownloadProgress('CORTEX_DL|video|video.part|100|100|10', t)
  updateTaskProgress(t)
  const first = t.overallProgress
  parseDownloadProgress('CORTEX_DL|audio|audio.part|1|100|10', t)
  updateTaskProgress(t)
  assert.ok(t.overallProgress >= first)
  assert.equal(t.downloadedBytes, 101)
  parseDownloadProgress('CORTEX_DL|audio|audio.part|0|100|10', t)
  assert.equal(t.downloadedBytes, 101, 'same-stream retry must not add bytes')
  parseDownloadProgress('CORTEX_DL|audio|audio.part|50|100|10', t)
  assert.equal(t.downloadedBytes, 150)
  const resumed = task({ engine: 'ytdlp', ytdlpExpectedBytes: 200, ytdlpStreams: structuredClone(t.ytdlpStreams) })
  parseDownloadProgress('CORTEX_DL|audio|audio.part|50|100|10', resumed)
  assert.equal(resumed.downloadedBytes, 150, 'resumed stream must not double-count')
  parseStateTransition('[Merger] Merging formats into "x.mp4"', t, { totalDuration: null, stderr: '' }, { sendUpdate: updateTaskProgress, saveState: () => {} })
  assert.equal(t.phase, 'merging')
  assert.equal(t.phaseProgress, null)
  assert.ok(t.overallProgress < 100)
  t.status = 'converting'; updateTaskProgress(t)
  assert.equal(t.phase, 'converting')
  assert.ok(t.overallProgress < 100)
  t.status = 'completed'; updateTaskProgress(t)
  assert.equal(t.overallProgress, 100)
})
test('all shared media formats, including uncommon ones, validate', () => {
  for (const ext of ['flac', 'aac', 'opus', 'wma', 'ogv', 'm4v', 'gif']) assert.equal(isSupportedMediaPath(`file.${ext}`), true)
  assert.equal(isSupportedMediaPath('file.part'), false)
})
test('yt-dlp continuation flags preserve partial files', () => {
  const yt = new YoutubeEngine()
  const args = yt.buildYtdlpArgs(task({ engine: 'ytdlp' }), 'bestVideo', { ffmpegDir: '.' }, runtime())
  assert.ok(args.includes('--continue'))
  assert.ok(!args.includes('--force-overwrites'))
  assert.ok(!args.includes('--no-check-certificate'))
  assert.ok(args.some(arg => arg.includes('%(info.format_id)s') && arg.includes('%(progress.filename)s')))
})
test('Pause All pauses queued and active phases; retry timers cannot resurrect canceled/deleted tasks', async () => {
  const manager = new DownloadManager()
  manager.schedule = () => {}
  const queued = task({ id: 'queued', status: 'queued' })
  const active = ['downloading', 'merging', 'converting'].map((status, i) => task({ id: `active-${i}`, status }))
  for (const t of [queued, ...active]) {
    manager.tasks.set(t.id, t); manager.runtime.set(t.id, runtime())
    if (t !== queued) { manager.active.add(t.id); manager.engines.set(t.id, { pause: () => {}, stop: () => {} }) }
  }
  await manager.pauseAll()
  assert.equal(queued.status, 'paused')
  for (const t of active) assert.equal(t.status, 'paused')
  await manager.resumeAll()
  assert.equal(queued.status, 'queued')
  manager.scheduleRetry('queued', 10000)
  await manager.cancel('queued')
  assert.equal(manager.retryTimers.has('queued'), false)
  const other = task({ id: 'delete', status: 'queued' })
  manager.tasks.set(other.id, other); manager.runtime.set(other.id, runtime())
  manager.scheduleRetry(other.id, 10000)
  await manager.delete(other.id, false)
  assert.equal(manager.retryTimers.has(other.id), false)
  assert.equal(manager.tasks.has(other.id), false)
})
test('delete without file removal preserves output', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-delete-'))
  const filePath = path.join(directory, 'kept.mp4')
  await fs.writeFile(filePath, 'keep')
  try {
    const manager = new DownloadManager()
    manager.schedule = () => {}
    const t = task({ id: 'keep', directory, filePath, status: 'completed' })
    manager.tasks.set(t.id, t); manager.runtime.set(t.id, runtime())
    await manager.delete(t.id, false)
    assert.equal(await fs.readFile(filePath, 'utf8'), 'keep')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
test('completion statistics count a task once', () => {
  const manager = new DownloadManager()
  const t = task({ id: 'stats' })
  manager.tasks.set(t.id, t); manager.runtime.set(t.id, runtime())
  const events = []
  manager.attachWindow({ isDestroyed: () => false, webContents: { send: (channel, data) => events.push({ channel, data }) } })
  const ctx = manager.createContext(t.id)
  ctx.sendStats(t.id, 100)
  ctx.sendStats(t.id, 100)
  assert.equal(events.filter(e => e.channel === 'cortexdl:download-stats-updated').length, 1)
})
test('SQLite progress uses backend overall progress', () => {
  const manager = new DownloadManager()
  const item = task({ engine: 'ytdlp', status: 'merging', downloadedBytes: 100, totalBytes: 100 })
  manager.upsertTaskToDb(item)
  assert.equal(dbMock.lastRow.progress, item.overallProgress)
  assert.equal(dbMock.lastRow.progress, 90)
  assert.equal(JSON.parse(dbMock.lastRow.full_payload).overallProgress, 90)
  manager.upsertTaskToDb(task({ totalBytes: null, downloadedBytes: 10 }))
  assert.equal(dbMock.lastRow.progress, null)
})
test('resume broadcasts a consistent downloading phase', async () => {
  const manager = new DownloadManager()
  manager.schedule = () => {}
  const item = task({ id: 'resume-phase', engine: 'missing-engine', status: 'queued', phase: 'paused' })
  manager.tasks.set(item.id, item); manager.runtime.set(item.id, runtime())
  const updates = []
  manager.attachWindow({ isDestroyed: () => false, webContents: { send: (_channel, data) => updates.push({ ...data }) } })
  await manager.executeEngine(item.id)
  assert.equal(updates[0].status, 'downloading')
  assert.notEqual(updates[0].phase, 'paused')
})
test('terminal IPC state bypasses throttle and cancels stale trailing update', () => {
  const sent = []
  const win = { isDestroyed: () => false, webContents: { send: (_channel, value) => sent.push({ ...value }) } }
  const rt = runtime()
  const t = task()
  throttledSendUpdate(win, t, rt)
  t.downloadedBytes = 20; throttledSendUpdate(win, t, rt)
  t.status = 'paused'; throttledSendUpdate(win, t, rt)
  assert.equal(sent.at(-1).status, 'paused')
  assert.equal(sent.length, 2)
})
test('FFmpeg discards an existing partial output before starting', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-ffmpeg-'))
  const output = path.join(directory, 'file.mp4')
  await fs.writeFile(output, Buffer.from('readable but incomplete media'))
  const childProcess = require('node:child_process')
  const originalSpawn = childProcess.spawn
  let partialWasRemoved = false
  childProcess.spawn = (_binary, args) => {
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    process.nextTick(async () => {
      if (!args.includes('-version')) {
        partialWasRemoved = await fs.stat(output).then(() => false).catch(() => true)
        await fs.writeFile(output, Buffer.from('finished'))
      }
      proc.emit('close', 0)
    })
    return proc
  }
  try {
    const t = task({ engine: 'ffmpeg', filePath: output, directory })
    await runFfmpegDownload(t, runtime(), context(runtime()))
    assert.equal(partialWasRemoved, true)
    assert.equal(t.status, 'completed')
    assert.equal(t.downloadedBytes, 8)
  } finally {
    childProcess.spawn = originalSpawn
    await fs.rm(directory, { recursive: true, force: true })
  }
})
const ffmpegBinary = path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const ffprobeBinary = path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const ytdlpBinary = path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
function makeAudioFixture(input, output, args) {
  const result = spawnSync(ffmpegBinary, ['-y', '-hide_banner', '-loglevel', 'error', ...args, output], { timeout: 30000 })
  assert.equal(result.status, 0, result.stderr?.toString())
}

test('bundled yt-dlp emits stream identity in the progress template', async t => {
  if (!existsSync(ffmpegBinary) || !existsSync(ytdlpBinary)) return t.skip('bundled media tools unavailable')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-ytdlp-template-'))
  const source = path.join(directory, 'clip.m4a')
  makeAudioFixture(null, source, ['-f', 'lavfi', '-i', 'sine=duration=0.25', '-c:a', 'aac', '-f', 'ipod'])
  const body = await fs.readFile(source)
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': body.length })
    res.end(body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const template = 'download:CORTEX_DL|%(info.format_id)s|%(progress.filename)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s'
    const child = require('node:child_process').spawn(ytdlpBinary, [
      '--ignore-config', '--no-playlist', '--no-mtime', '--newline', '--progress',
      '--progress-template', template, '-o', path.join(directory, 'download.%(ext)s'),
      `http://127.0.0.1:${server.address().port}/clip.m4a`,
    ], { windowsHide: true })
    let output = ''
    child.stdout.on('data', data => { output += data.toString() })
    child.stderr.on('data', data => { output += data.toString() })
    const code = await new Promise(resolve => { child.on('close', resolve); child.on('error', () => resolve(1)) })
    assert.equal(code, 0, output)
    const item = task({ engine: 'ytdlp' })
    assert.equal(parseDownloadProgress(output, item), true, output)
    assert.ok(Object.keys(item.ytdlpStreams).some(key => key.includes('download.m4a')))
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('FFmpeg engine creates real codec/container output for every audio format', async t => {
  if (!existsSync(ffmpegBinary) || !existsSync(ffprobeBinary)) return t.skip('bundled FFmpeg tools unavailable')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-audio-engine-'))
  try {
    const source = path.join(directory, 'source.wav')
    makeAudioFixture(null, source, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25', '-c:a', 'pcm_s16le'])
    for (const format of AUDIO_FORMATS) {
      const output = path.join(directory, `engine.${format}`)
      const rt = runtime()
      const item = task({ engine: 'ffmpeg', targetFormat: format, url: source, filePath: output, directory })
      await runFfmpegDownload(item, rt, context(rt))
      assert.equal(item.status, 'completed', format)
      assert.ok(matchesAudioFormat(format, await probeMediaFile(item.filePath)), format)
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('YouTube finalization produces real audio formats, including AAC ADTS from M4A', async t => {
  if (!existsSync(ffmpegBinary) || !existsSync(ffprobeBinary)) return t.skip('bundled FFmpeg tools unavailable')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-audio-final-'))
  try {
    const sourceWav = path.join(directory, 'source.wav')
    makeAudioFixture(null, sourceWav, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25', '-c:a', 'pcm_s16le'])
    for (const format of AUDIO_FORMATS) {
      const id = `test-${format}`
      const source = path.join(directory, `${id}.m4a`)
      makeAudioFixture(sourceWav, source, ['-i', sourceWav, '-c:a', 'aac', '-f', 'ipod'])
      const rt = runtime()
      rt.abortController = new AbortController()
      const item = task({ id, engine: 'ytdlp', targetFormat: format, directory, title: `Audio ${format}`, filePath: path.join(directory, `wanted.${format}`) })
      await new YoutubeEngine().finalizeDownloaded(item, source, rt, context(rt))
      assert.equal(rt.child, null, 'finalization processes must be released')
      assert.equal(path.extname(item.filePath), `.${format}`)
      assert.ok(matchesAudioFormat(format, await probeMediaFile(item.filePath)), format)
      if (format !== 'm4a') assert.equal(await fs.stat(source).then(() => true).catch(() => false), false)
      if (format === 'aac') {
        const probe = await probeMediaFile(item.filePath)
        assert.equal(probe.format.format_name, 'aac', 'AAC must be ADTS, not renamed M4A')
      }
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('cancel during final audio conversion drains and releases FFmpeg while keeping the source', async t => {
  if (!existsSync(ffmpegBinary) || !existsSync(ffprobeBinary)) return t.skip('bundled FFmpeg tools unavailable')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-convert-cancel-'))
  const childProcess = require('node:child_process')
  const originalSpawn = childProcess.spawn
  try {
    const source = path.join(directory, 'cancel.m4a')
    makeAudioFixture(null, source, ['-f', 'lavfi', '-i', 'sine=duration=0.25', '-c:a', 'aac', '-f', 'ipod'])
    const rt = runtime(); rt.abortController = new AbortController()
    const item = task({ id: 'cancel', engine: 'ytdlp', targetFormat: 'aac', directory, filePath: path.join(directory, 'wanted.aac') })
    const yt = new YoutubeEngine()
    let stdoutDrained = false
    let stderrDrained = false
    childProcess.spawn = (binary, args, opts) => {
      if (!args.includes('-nostdin')) return originalSpawn(binary, args, opts)
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter(); proc.stdout.resume = () => { stdoutDrained = true }
      proc.stderr = new EventEmitter()
      proc.kill = () => { setImmediate(() => proc.emit('close', 1)); return true }
      setImmediate(() => {
        stderrDrained = proc.stderr.listenerCount('data') > 0
        rt.abortController.abort()
        yt.stop()
      })
      return proc
    }
    await assert.rejects(yt.finalizeDownloaded(item, source, rt, context(rt)), /aborted/i)
    assert.equal(stdoutDrained, true)
    assert.equal(stderrDrained, true)
    assert.equal(rt.child, null)
    assert.equal(await fs.stat(source).then(() => true).catch(() => false), true)
  } finally {
    childProcess.spawn = originalSpawn
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('DirectEngine range chunks and advertised-Range fallback produce exact output', async () => {
  const body = Buffer.alloc(5 * 1024 * 1024 + 4096, 73)
  for (const ignore of [false, true]) {
    await withServer(body, ignore, false, async (url, s) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-test-'))
      try {
        const t = task({ url, directory, filePath: path.join(directory, 'file.mp4'), totalBytes: null })
        await new DirectEngine().download(t, context(runtime()))
        assert.deepEqual(await fs.readFile(t.filePath), body)
        assert.equal(t.overallProgress, 100)
        assert.ok(s.rangeRequests > 0)
        if (ignore) assert.equal(t.supportsRanges, undefined)
      } finally { await fs.rm(directory, { recursive: true, force: true }) }
    })
  }
})
test('DirectEngine pause and resume keeps chunk state', async () => {
  const body = Buffer.alloc(5 * 1024 * 1024 + 4096, 42)
  await withServer(body, false, true, async url => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-resume-'))
    try {
      const t = task({ url, directory, filePath: path.join(directory, 'file.mp4'), totalBytes: null })
      const engine = new DirectEngine()
      const first = engine.download(t, context(runtime()))
      await new Promise(resolve => setTimeout(resolve, 30))
      engine.pause()
      await assert.rejects(first)
      assert.ok(t.resumeChunks?.length)
      await new DirectEngine().download(t, context(runtime()))
      assert.deepEqual(await fs.readFile(t.filePath), body)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})
test('Direct Range fallback stays single-stream after pause and resume', async () => {
  const body = Buffer.alloc(5 * 1024 * 1024 + 4096, 55)
  await withServer(body, true, true, async (url, s) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-fallback-resume-'))
    try {
      const item = task({ url, directory, filePath: path.join(directory, 'file.mp4'), totalBytes: null })
      const engine = new DirectEngine()
      const first = engine.download(item, context(runtime()))
      const deadline = Date.now() + 5000
      while (!(item.supportsRanges === false && item.downloadedBytes > 32768) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.equal(item.supportsRanges, false)
      assert.ok(item.downloadedBytes > 32768)
      engine.pause()
      await assert.rejects(first)
      const beforeResume = s.rangeRequests
      await new DirectEngine().download(item, context(runtime()))
      assert.ok(s.rangeRequests - beforeResume <= 1, 'resume may probe once, but must not restart chunk mode')
      assert.deepEqual(await fs.readFile(item.filePath), body)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})
