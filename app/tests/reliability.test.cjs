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
  if (request === './engineReadiness' || request === '../engineReadiness') return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
  if (request === './paths' || request === '../paths') return { getBinaryPath: name => path.join(process.cwd(), 'engine-baseline', name + '.exe'), getBinDirectory: () => path.join(process.cwd(), 'engine-baseline') }
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
    if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': body.length, 'accept-ranges': 'bytes', etag: '"fixture-v1"' }); res.end(); return }
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

test('Direct backend progress reserves 100 for validated completion in the shared view', () => {
  const t = task({ downloadedBytes: 100 })
  updateTaskProgress(t)
  assert.equal(t.overallProgress, 99)
  assert.deepEqual(getProgressView(t), getProgressView({ ...t }))
  assert.equal(getProgressView(t).percentLabel, '99%')
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
  assert.equal(t.overallProgress, null)
  t.status = 'converting'; updateTaskProgress(t)
  assert.equal(t.phase, 'converting')
  assert.equal(t.overallProgress, null)
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

test('yt-dlp continuation quality selects 4K over lower AVC and respects resolution caps', async t => {
  const binary = path.join(process.cwd(), 'engine-baseline', 'yt-dlp.exe')
  if (!existsSync(binary)) return t.skip('Bundled yt-dlp is unavailable')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-quality-'))
  try {
    const infoPath = path.join(dir, 'info.json')
    const video = (id, height, vcodec, ext) => ({ format_id: id, height, width: height * 16 / 9, fps: 30, vcodec, acodec: 'none', ext, url: `https://fixture.invalid/${id}` })
    const formats = [video('avc-1080', 1080, 'avc1.640028', 'mp4'), video('vp9-2160', 2160, 'vp9', 'webm'),
      { format_id: 'audio', vcodec: 'none', acodec: 'mp4a.40.2', ext: 'm4a', abr: 128, url: 'https://fixture.invalid/audio' }]
    const select = async (profile, quality, available) => {
      await fs.writeFile(infoPath, JSON.stringify({ id: 'fixture', title: 'Quality fixture', extractor: 'generic', webpage_url: 'https://fixture.invalid/video', formats: available }))
      const args = new YoutubeEngine().buildYtdlpArgs(task({ targetFormat: profile === 'bestVideo' ? 'mp4' : 'mkv', ytdlpFormatId: quality }), profile, { ffmpegDir: '.' }, runtime(), ['--cookies', 'configured-cookies.txt'])
      assert.equal(args[args.indexOf('--cookies') + 1], 'configured-cookies.txt')
      const result = spawnSync(binary, ['--ignore-config', '--simulate', '--no-check-formats', '--load-info-json', infoPath, '--dump-single-json', '-f', args[args.indexOf('-f') + 1], '-S', args[args.indexOf('-S') + 1]], { encoding: 'utf8', timeout: 15000 })
      assert.equal(result.status, 0, result.stderr)
      return JSON.parse(result.stdout).format_id
    }
    for (const profile of ['bestVideo', 'default']) {
      assert.equal(await select(profile, undefined, formats), 'vp9-2160+audio')
      assert.equal(await select(profile, '1080p', formats), 'avc-1080+audio')
      const progressive = [720, 2160].map(height => ({ ...video(`combined-${height}`, height, 'avc1', 'mp4'), acodec: 'mp4a.40.2' }))
      assert.equal(await select(profile, '1080p', progressive), 'combined-720')
    }
    // Compatibility is a tie-breaker; it must never replace a higher resolution.
    const tiedFormats = [...formats, video('vp9-1080', 1080, 'vp9', 'webm')]
    assert.equal(await select('bestVideo', '1080p', tiedFormats), 'avc-1080+audio')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
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
test('SQLite progress uses backend overall progress', () => {
  const manager = new DownloadManager()
  const item = task({ engine: 'ytdlp', status: 'merging', downloadedBytes: 100, totalBytes: 100 })
  manager.upsertTaskToDb(item)
  assert.equal(dbMock.lastRow.progress, item.overallProgress)
  assert.equal(dbMock.lastRow.progress, null)
  assert.equal(JSON.parse(dbMock.lastRow.full_payload).overallProgress, null)
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
test('IPC phase changes remain visible within one throttle window and retire stale progress', async () => {
  const manager = new DownloadManager()
  const item = task({ id: 'fast-phase', attemptId: 'attempt', phase: 'downloading' })
  const attempt = { ...runtime(), attemptId: 'attempt', abortController: new AbortController() }
  manager.tasks.set(item.id, item)
  manager.runtime.set(item.id, attempt)
  manager.attempts.set(item.id, attempt)
  const sent = []
  manager.attachWindow({ isDestroyed: () => false, webContents: { send: (_channel, value) => sent.push({ ...value }) } })
  const draft = { ...item }
  const ctx = manager.createContext(item.id, attempt, draft)
  const clock = Date.now
  const now = clock()
  attempt.lastIpcAtMs = now
  Date.now = () => now
  try {
    ctx.sendUpdate(draft)
    draft.status = 'converting'; draft.phase = 'trimming'; ctx.sendUpdate(draft)
    draft.convertingPercent = 20; ctx.sendUpdate(draft)
    draft.phase = 'validating'; ctx.sendUpdate(draft)
    draft.phase = 'finalizing'; ctx.sendUpdate(draft)
    assert.deepEqual(sent.map(value => value.phase), ['trimming', 'validating', 'finalizing'])
    Date.now = clock
    await new Promise(resolve => setTimeout(resolve, 140))
    assert.equal(sent.length, 3, 'queued progress must not overwrite a newer phase')
    attempt.stopReason = 'canceled'
    draft.phase = 'trimming'; ctx.sendUpdate(draft)
    assert.equal(sent.length, 3, 'stopped attempts must remain ignored')
  } finally { Date.now = clock; manager.flushPendingSave() }
})
const ffmpegBinary = path.join(process.cwd(), 'engine-baseline', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const ffprobeBinary = path.join(process.cwd(), 'engine-baseline', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const ytdlpBinary = path.join(process.cwd(), 'engine-baseline', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
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
      const result = await runFfmpegDownload(item, rt, context(rt))
      assert.equal(result.kind, 'success', format)
      assert.equal(item.status, 'downloading', 'only manager can complete')
      assert.ok(matchesAudioFormat(format, await probeMediaFile(item.filePath)), format)
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
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
        assert.equal(t.overallProgress, 99)
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
      assert.equal((await first).kind, 'paused')
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
      assert.equal((await first).kind, 'paused')
      const beforeResume = s.rangeRequests
      await new DirectEngine().download(item, context(runtime()))
      assert.ok(s.rangeRequests - beforeResume <= 1, 'resume may probe once, but must not restart chunk mode')
      assert.deepEqual(await fs.readFile(item.filePath), body)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})


test('progress preserves validating/finalizing phases after a compatible yt-dlp merge', () => {
  for(const phase of ['validating','finalizing']) {
    const t=task({status:'merging',phase,engine:'ytdlp',downloadPercent:100,downloadedBytes:100,totalBytes:100})
    updateTaskProgress(t)
    assert.equal(t.phase,phase)
    assert.equal(t.phaseProgress,null)
    assert.equal(t.overallProgress,null)
    assert.equal(getProgressView(t).isIndeterminate,true)
  }
})

test('progress shows measured validation progress without completing early', () => {
  const t=task({status:'merging',phase:'validating',convertingPercent:42,downloadPercent:100})
  updateTaskProgress(t)
  assert.equal(t.phaseProgress,42)
  assert.equal(getProgressView(t).isIndeterminate,false)
  t.convertingPercent=100;updateTaskProgress(t)
  assert.equal(t.overallProgress,99)
  assert.notEqual(t.status,'completed')
  t.phase='finalizing';updateTaskProgress(t)
  assert.equal(t.phaseProgress,null)
})


test('progress replaces an approximate metadata total once every selected stream is observed', () => {
  const t=task({engine:'ytdlp',ytdlpExpectedBytes:400,ytdlpExpectedStreamCount:2})
  parseDownloadProgress('CORTEX_DL|video|v.part|50|100|10',t)
  assert.equal(t.totalBytes,400)
  parseDownloadProgress('CORTEX_DL|audio|a.part|25|100|10',t)
  assert.equal(t.totalBytes,200)
  assert.equal(t.downloadedBytes,75)
  assert.equal(t.downloadPercent,38)
})
