require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Module = require('node:module')
const originalLoad = Module._load
const bin = name => path.resolve('engine-baseline', name + '.exe')
Module._load = function(request, parent, ...rest) {
  if (request === './engineReadiness' || request === '../engineReadiness') return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
  if (request === 'electron-log') return { info(){}, warn(){}, error(){} }
  if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir() } }
  if (request === './paths' || request === '../paths') return { getBinaryPath: bin, getBinDirectory: () => path.resolve('engine-baseline') }
  return originalLoad.call(this, request, parent, ...rest)
}
const { prepareYouTubeSubtitle, validateSubtitleFile, embedYouTubeSubtitle } = require('../Back-End/electron/youtubeSubtitles.ts')
const { mediaOutputArgs } = require('../Back-End/electron/mediaFormatRegistry.ts')
const { probeMediaFile } = require('../Back-End/electron/mediaFiles.ts')
const { runMediaProcess } = require('../Back-End/electron/mediaPipeline.ts')
const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:00.900\nترجمة عربية للاختبار\n'
const limited = { exitCode: 1, stderr: "Unable to download video subtitles for 'ar': HTTP Error 429: Too Many Requests" }
async function sandbox(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-captions-'))
  const task = { id: 'test', directory, subtitleLanguage: 'ar', targetFormat: 'mp4' }
  try { await run(task) } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

test('YouTube subtitles validate cues and reject missing, empty, HTML and header-only files', () => sandbox(async task => {
  const file = path.join(task.directory, 'test.ar.vtt')
  assert.equal(await validateSubtitleFile(file), false)
  for (const content of ['', 'WEBVTT\n', '<html>login required</html>', 'WEBVTT\n\nNOTE missing cues',
    'WEBVTT\n\n00:00:01.000 --> 00:00:00.000\nBackwards\n', 'WEBVTT\n\n00:99:00.000 --> 00:99:02.000\nBad clock\n',
    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<html>Error</html>\n']) {
    await fs.writeFile(file, content); assert.equal(await validateSubtitleFile(file), false)
  }
  await fs.writeFile(file, vtt); assert.equal(await validateSubtitleFile(file), true)
  let called = false
  assert.equal(await prepareYouTubeSubtitle(task, [], new AbortController().signal, async () => { called = true }), file)
  assert.equal(called, false, 'resume reuses valid owned subtitles')
}))

test('YouTube subtitle-only cookies retry is bounded and preserves the original cookie file', () => sandbox(async task => {
  const original = path.join(task.directory, 'synthetic-original.txt')
  await fs.writeFile(original, 'synthetic fixture, no real credentials')
  const seen = []
  const file = await prepareYouTubeSubtitle(task, ['--cookies', original], new AbortController().signal, async cookies => {
    seen.push(cookies)
    if (!cookies.length) return { exitCode: 1, stderr: 'LOGIN_REQUIRED' }
    assert.notEqual(cookies[1], original)
    assert.notEqual(path.dirname(cookies[1]), task.directory, 'credentials belong in private OS temp')
    assert.equal(await fs.readFile(cookies[1], 'utf8'), 'synthetic fixture, no real credentials')
    await fs.writeFile(cookies[1], 'yt-dlp rewritten cookie jar')
    await fs.writeFile(path.join(task.directory, 'test.ar.vtt'), vtt)
    return { exitCode: 0, stderr: '' }
  })
  assert.equal(await validateSubtitleFile(file), true)
  assert.equal(seen.length, 2)
  assert.deepEqual(seen[0], [])
  await assert.rejects(fs.stat(seen[1][1]), /ENOENT/)
  assert.equal(await fs.readFile(original, 'utf8'), 'synthetic fixture, no real credentials')
}))

test('YouTube subtitle failures and cancellation clean temporary credentials and never certify missing captions', () => sandbox(async task => {
  const original = path.join(task.directory, 'synthetic-original.txt')
  await fs.writeFile(original, 'synthetic')
  for (const mode of ['limited', 'cancel', 'throw', 'missing']) {
    let calls = 0, copy
    const controller = new AbortController()
    const run = async cookies => {
      if (++calls === 1) return { exitCode: 1, stderr: 'LOGIN_REQUIRED' }
      copy = cookies[1]
      if (mode === 'cancel') { controller.abort(); return limited }
      if (mode === 'throw') throw new Error('Child process failed')
      return mode === 'missing' ? { exitCode: 0, stderr: '' } : limited
    }
    await assert.rejects(prepareYouTubeSubtitle(task, ['--cookies', original], controller.signal, run),
      mode === 'cancel' ? /abort/i : mode === 'throw' ? /Child process failed/ : mode === 'missing' ? /YOUTUBE_SUBTITLE_UNAVAILABLE/ : /YOUTUBE_SUBTITLE_RATE_LIMITED/)
    assert.equal(calls, 2)
    await assert.rejects(fs.stat(copy), /ENOENT/)
    assert.equal(await fs.readFile(original, 'utf8'), 'synthetic')
  }
}))

test('YouTube unrelated subtitle failures make no account request and reject invalid language paths', () => sandbox(async task => {
  let calls = 0
  await assert.rejects(prepareYouTubeSubtitle(task, ['--cookies', 'unused'], new AbortController().signal, async () => {
    calls++; return { exitCode: 1, stderr: 'ERROR: HTTP Error 500: unavailable' }
  }), /500/)
  assert.equal(calls, 1)
  await assert.rejects(prepareYouTubeSubtitle({ ...task, subtitleLanguage: '../outside' }, [], new AbortController().signal, async () => {}), /Invalid subtitle language/)
  await assert.rejects(prepareYouTubeSubtitle(task, [], new AbortController().signal, async () => limited), /YOUTUBE_SUBTITLE_RATE_LIMITED/)
}))

test('YouTube subtitle 429 stops without testing an account and removes partial caption files', () => sandbox(async task => {
  let calls = 0
  const file = path.join(task.directory, 'test.ar.vtt')
  await assert.rejects(prepareYouTubeSubtitle(task, ['--cookies', 'must-not-read'], new AbortController().signal, async args => {
    calls++; assert.deepEqual(args, []); await fs.writeFile(file + '.part', '<html>rate limited</html>'); return limited
  }), /YOUTUBE_SUBTITLE_RATE_LIMITED/)
  assert.equal(calls, 1)
  await assert.rejects(fs.stat(file + '.part'), /ENOENT/)
}))

test('YouTube cookie validation rejects expired exports, fake domains and malformed rows without certifying sign-in', () => sandbox(async task => {
  const { CookieValidationCache } = require('../Back-End/electron/cookieValidation.ts')
  const file = path.join(task.directory, 'export.txt'), cache = new CookieValidationCache()
  for (const [body, code] of [
    ['# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1\tSID\tfixture', 'expired'],
    ['# Netscape HTTP Cookie File\n.youtube.com.evil.test\tTRUE\t/\tTRUE\t0\tSID\tfixture', 'missing_youtube'],
    ['# Netscape HTTP Cookie File\n# youtube.com\nmalformed-row', 'invalid_rows'],
    ['# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfixture', 'valid'],
  ]) {
    await fs.writeFile(file, body)
    const result = await cache.validate(file)
    assert.equal(result.code, code)
    if (result.valid) assert.match(result.message, /not been verified/)
  }
}))

test('YouTube output verification rejects changed resolution, FPS, missing audio and subtitle language', () => {
  const { validateSubtitleMedia } = require('../Back-End/electron/mediaFormatRegistry.ts')
  const source = { streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001' }, { codec_type: 'audio' }] }
  const output = { streams: [...source.streams, { codec_type: 'subtitle', tags: { language: 'ara' } }] }
  validateSubtitleMedia(source, output, 'ar')
  for (const [key, value] of [['height', 360], ['width', 640], ['avg_frame_rate', '25/1']]) {
    assert.throws(() => validateSubtitleMedia(source, { streams: [{ ...source.streams[0], [key]: value }, ...output.streams.slice(1)] }, 'ar'), /resolution|FPS/)
  }
  assert.throws(() => validateSubtitleMedia(source, { streams: [source.streams[0], output.streams[2]] }, 'ar'), /audio/)
  assert.throws(() => validateSubtitleMedia(source, output, 'en'), /SUBTITLE_UNAVAILABLE/)
})

test('YouTube subtitle retry requires a completed media receipt and rejects partial or redirected files', () => sandbox(async task => {
  const { rememberCompletedYouTubeMedia, findCompletedYouTubeMedia } = require('../Back-End/electron/youtubeMediaCache.ts')
  const file = path.join(task.directory, 'test.mp4')
  await fs.writeFile(file, 'playable header is not proof of completion')
  assert.equal(await findCompletedYouTubeMedia(task), null)
  await rememberCompletedYouTubeMedia(task, file)
  assert.equal(await findCompletedYouTubeMedia(task), file)
  await fs.appendFile(file, 'changed')
  assert.equal(await findCompletedYouTubeMedia(task), null)
  await fs.writeFile(path.join(task.directory, 'test.media-ready.json'), JSON.stringify({ file: '../outside.mp4', size: 1 }))
  assert.equal(await findCompletedYouTubeMedia(task), null)
}))

test('YouTube subtitle merge retains video/audio packets and publishes a real subtitle stream', () => sandbox(async task => {
  const media = path.join(task.directory, 'test.mkv'), subtitle = path.join(task.directory, 'test.ar.vtt')
  const fixture = spawnSync(bin('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', media], { windowsHide: true, timeout: 30000 })
  assert.equal(fixture.status, 0, fixture.stderr?.toString())
  await fs.writeFile(subtitle, vtt)
  const context = { runtime: { abortController: new AbortController(), child: null }, sendUpdate(){} }
  const merged = await embedYouTubeSubtitle(task, context, media, subtitle)
  const probe = spawnSync(bin('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,height', '-of', 'json', merged], { windowsHide: true, encoding: 'utf8', timeout: 15000 })
  assert.equal(probe.status, 0)
  const streams = JSON.parse(probe.stdout).streams
  assert.deepEqual(streams.map(stream => stream.codec_type), ['video', 'audio', 'subtitle'])
  assert.equal(streams[0].height, 1080)
  const packetHash = file => {
    const output = spawnSync(bin('ffmpeg'), ['-v', 'error', '-i', file, '-map', '0:v', '-map', '0:a', '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-'],
      { windowsHide: true, encoding: 'utf8', timeout: 15000 })
    assert.equal(output.status, 0)
    // Containers use different timestamp bases; compare the encoded packet hashes.
    const hashes = output.stdout.split(/\r?\n/).filter(line => /^\d+,/.test(line))
    assert.equal(hashes.length, 2)
    return hashes.join('\n')
  }
  assert.equal(packetHash(merged), packetHash(media), 'subtitles must not recode or lower video/audio quality')
  const sourceProbe = await probeMediaFile(merged)
  assert.equal(sourceProbe.streams[0].width, 1920)
  assert.equal(sourceProbe.streams[0].avg_frame_rate, '30/1')
  assert.equal(sourceProbe.streams[2].tags.language, 'ar')
  for (const [format, codec] of [['mp4', 'mov_text'], ['webm', 'webvtt']]) {
    const output = path.join(task.directory, 'final.' + format)
    await runMediaProcess(['-i', merged, ...mediaOutputArgs(format, output, sourceProbe)], task, context)
    const finalProbe = await probeMediaFile(output)
    assert.ok(finalProbe.streams.some(stream => stream.codec_type === 'subtitle' && stream.codec_name === codec), `${format} must retain embedded captions`)
    assert.equal(finalProbe.streams[0].height, 1080)
    assert.equal(finalProbe.streams[0].avg_frame_rate, '30/1')
    if (format === 'mp4') assert.equal(packetHash(output), packetHash(media))
  }
  assert.equal(context.runtime.child, null)
}))
