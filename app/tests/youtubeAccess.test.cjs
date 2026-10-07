require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const os = require('node:os')
const originalLoad = Module._load
const cookies = ['--cookies', 'synthetic-cookies.txt']
const calls = []
let extract = async () => info(1080)
function info(height) {
  return JSON.stringify({ title: 'Fixture', formats: [{ format_id: String(height), height, vcodec: 'avc1', acodec: 'none' }],
    automatic_captions: { ar: [{ name: 'Arabic' }] } })
}
Module._load = function(request, parent, ...rest) {
  if (request === 'electron-log') return { info(){}, warn(){}, error(){} }
  if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir() } }
  if (request === './db') return { db: { prepare: () => ({ get: () => ({ value: cookies[1] }) }) } }
  if (request === './paths' || request === '../paths') return { getBinaryPath: () => process.execPath, getBinDirectory: () => os.tmpdir() }
  if (request === './cookieValidation') return { CookieValidationCache: class {
    async validate(filePath) { return { valid: true, filePath } }
    fingerprint(filePath) { return filePath }
  } }
  if (request === './analysisProcess') return { extractAnalysis: async (_binary, args, signal) => {
    signal.throwIfAborted(); calls.push(args); return extract(args)
  } }
  if (request === './previewExtraction') return { PREVIEW_FORMAT: 'best', TRIM_PREVIEW_FORMAT: 'bestvideo+bestaudio',
    extractPreview: async (_binary, args) => { calls.push(args); return extract(args) },
    extractPreviewStreams: async (_binary, args) => { calls.push(args); return extract(args) } }
  if (request === '../mediaFiles' && parent.filename.endsWith('YoutubeEngine.ts')) return { findTaskMediaFile: async () => 'fixture.mp4' }
  return originalLoad.call(this, request, parent, ...rest)
}
const { youtubeErrorCode, isYouTubeAuthRequiredError, isYouTubeUrl } = require('../Shared/youtubeErrors.ts')
const { withYouTubeCookieFallback } = require('../Back-End/electron/youtubeAccess.ts')
const { analyzeWithYtdlp, getDirectStreamUrl, getTrimPreviewStreams } = require('../Back-End/electron/ytdlp.ts')
const { YoutubeEngine } = require('../Back-End/electron/engines/YoutubeEngine.ts')
const { normalizeIpcError, youtubeErrorMessage } = require('../Front-End/src/lib/downloadHelpers.ts')
const { translations } = require('../Front-End/src/translations.ts')

test('YouTube subtitle 429 is never reported as authentication, including generic cookies advice', () => {
  const subtitle = "ERROR: Unable to download video subtitles for 'ar': HTTP Error 429: Too Many Requests"
  for (const error of [subtitle, new Error(subtitle), { stderr: subtitle }, new Error('Failed', { cause: new Error(subtitle) })]) {
    assert.equal(youtubeErrorCode(error), 'YOUTUBE_SUBTITLE_RATE_LIMITED')
    assert.equal(isYouTubeAuthRequiredError(error), false)
  }
  assert.equal(youtubeErrorCode('HTTP Error 429. Use --cookies-from-browser or --cookies'), 'YOUTUBE_RATE_LIMITED')
  assert.equal(youtubeErrorCode('Sign in to confirm you are not a bot'), 'YOUTUBE_AUTH_REQUIRED')
  assert.equal(youtubeErrorCode('HTTP Error 403: Forbidden'), null)
})

test('YouTube public-first policy checks the hostname and preserves other providers', async () => {
  assert.equal(isYouTubeUrl('https://www.youtube.com/watch?v=abcdefghijk'), true)
  assert.equal(isYouTubeUrl('https://youtu.be/abcdefghijk'), true)
  assert.equal(isYouTubeUrl('https://youtube.com.evil.invalid/watch?v=abcdefghijk'), false)
  assert.equal(isYouTubeUrl('https://example.invalid/?url=youtube.com'), false)
  const seen = []
  await withYouTubeCookieFallback('https://vimeo.com/123', cookies, undefined, async args => { seen.push(args); return 'ok' })
  assert.deepEqual(seen, [cookies])
})

test('YouTube analysis preserves 1080p when configured cookies would expose only 360p', async () => {
  calls.length = 0
  extract = async args => info(args.includes('--cookies') ? 360 : 1080)
  const result = await analyzeWithYtdlp('https://youtu.be/publicfix01')
  assert.equal(result.formats[0].height, 1080)
  assert.equal(result.subtitles.find(track => track.languageCode === 'ar').isAutomatic, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].includes('--cookies'), false)
})

test('YouTube analysis uses cookies once for real sign-in requirements and keeps private formats', async () => {
  calls.length = 0
  extract = async args => {
    if (!args.includes('--cookies')) throw new Error('Sign in to confirm your age')
    return info(720)
  }
  const result = await analyzeWithYtdlp('https://youtu.be/privatefix1')
  assert.equal(result.formats[0].height, 720)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].includes('--cookies'), false)
  assert.equal(calls[0].includes('--ignore-errors'), false, 'sign-in failures must propagate to the fallback')
  assert.equal(calls[1][calls[1].indexOf('--cookies') + 1], cookies[1])
})

test('YouTube analysis 429 makes one request and does not switch to cookies', async () => {
  calls.length = 0
  extract = async () => { throw new Error('HTTP Error 429: Too Many Requests; use --cookies-from-browser or --cookies') }
  await assert.rejects(analyzeWithYtdlp('https://youtu.be/limitedfix1'), /YOUTUBE_RATE_LIMITED/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].includes('--cookies'), false)
})

test('YouTube preview and trim use the same public-first and bounded authentication fallback', async () => {
  for (const preview of [getDirectStreamUrl, getTrimPreviewStreams]) {
    calls.length = 0
    extract = async () => 'https://fixture.invalid/video'
    await preview('https://youtu.be/previewfix1')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].includes('--cookies'), false)
    extract = async args => {
      if (!args.includes('--cookies')) throw new Error('LOGIN_REQUIRED')
      return 'https://fixture.invalid/private'
    }
    calls.length = 0
    await preview('https://youtu.be/previewfix1')
    assert.equal(calls.length, 2)
    assert.equal(calls[1].includes('--cookies'), true)
  }
})

test('YouTube cookie fallback stops after authentication fails and honors cancellation', async () => {
  let count = 0
  await assert.rejects(withYouTubeCookieFallback('https://youtu.be/abcdefghijk', cookies, undefined, async () => {
    count++; throw new Error('LOGIN_REQUIRED')
  }), /LOGIN_REQUIRED/)
  assert.equal(count, 2)
  const controller = new AbortController()
  count = 0
  await assert.rejects(withYouTubeCookieFallback('https://youtu.be/abcdefghijk', cookies, controller.signal, async () => {
    count++; controller.abort(); throw new Error('LOGIN_REQUIRED')
  }), /abort/i)
  assert.equal(count, 1)
})

function task() {
  return { id: 'fixture', url: 'https://youtu.be/abcdefghijk', directory: os.tmpdir(), filename: 'fixture.mp4',
    filePath: 'fixture.mp4', title: 'Fixture', thumbnail: 'https://fixture.invalid/thumb', targetFormat: 'mp4',
    status: 'downloading', subtitleLanguage: 'ar', subtitleIsAutomatic: true, ytdlpFormatId: '1080p' }
}
function context() { return { runtime: { abortController: null, child: null, retries: 0 }, sendUpdate(){}, saveState(){} } }

test('YouTube download keeps selected quality and subtitles without sending cookies on public success', async () => {
  const engine = new YoutubeEngine(), seen = []
  engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
    seen.push(args); return { exitCode: 0, detectedFinalPath: 'fixture.mp4', stderr: '' }
  }
  assert.equal((await engine.download(task(), context())).kind, 'success')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].includes('--cookies'), false)
  assert.match(seen[0][seen[0].indexOf('-f') + 1], /height<=1080/)
  assert.equal(seen[0].includes('--write-auto-subs'), true)
  assert.equal(seen[0].includes('--embed-subs'), true)
})

test('YouTube download retries real authentication once, while subtitle 429 stops without cookies', async () => {
  for (const failure of ['LOGIN_REQUIRED', "Unable to download video subtitles for 'ar': HTTP Error 429: Too Many Requests"]) {
    const engine = new YoutubeEngine(), seen = []
    engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
      seen.push(args); return { exitCode: 1, detectedFinalPath: null, stderr: failure }
    }
    const result = await engine.download(task(), context())
    assert.deepEqual(result, { kind: 'fatal-error', message: failure === 'LOGIN_REQUIRED' ? 'YOUTUBE_AUTH_REQUIRED' : 'YOUTUBE_SUBTITLE_RATE_LIMITED' })
    assert.equal(seen.length, failure === 'LOGIN_REQUIRED' ? 2 : 1)
    if (seen.length === 2) assert.equal(seen[1].includes('--cookies'), true)
    assert.equal(seen[0].includes('--cookies'), false)
  }
})

test('Arabic and English errors distinguish subtitle throttling, request throttling and sign-in', () => {
  for (const messages of Object.values(translations)) {
    for (const [code, message] of [['YOUTUBE_AUTH_REQUIRED', messages.youtube_auth_required],
      ['YOUTUBE_RATE_LIMITED', messages.youtube_rate_limited], ['YOUTUBE_SUBTITLE_RATE_LIMITED', messages.youtube_subtitle_rate_limited]]) {
      assert.equal(youtubeErrorMessage(code, messages), message)
      assert.equal(normalizeIpcError(new Error(`Error invoking remote method 'analyze': Error: ${code}`), 'fallback', messages), message)
    }
    assert.equal(normalizeIpcError('HTTP Error 429: Too Many Requests', 'fallback', messages), messages.youtube_rate_limited)
    assert.equal(normalizeIpcError('', 'fallback', messages), 'fallback')
  }
})

test('YouTube media 403 tries public HLS once with the same quality and subtitles', async () => {
  const engine = new YoutubeEngine(), seen = []
  engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
    seen.push(args)
    return seen.length === 1 ? { exitCode: 1, detectedFinalPath: null, stderr: 'unable to download video data: HTTP Error 403: Forbidden' }
      : { exitCode: 0, detectedFinalPath: 'fixture.mp4', stderr: '' }
  }
  assert.equal((await engine.download(task(), context())).kind, 'success')
  assert.equal(seen.length, 2)
  const selector = seen[1][seen[1].indexOf('-f') + 1]
  assert.equal(selector, 'bestvideo[protocol^=m3u8][height<=1080]+bestaudio[protocol^=m3u8]/best[protocol^=m3u8][height<=1080]')
  assert.equal(seen[1].includes('--cookies'), false)
  assert.equal(seen[1].includes('--write-auto-subs'), true)
  assert.equal(seen[1].includes('--embed-subs'), true)
  assert.equal(seen[1][seen[1].indexOf('--sub-langs') + 1], 'ar')
})

test('YouTube HLS fallback is bounded, skips subtitle errors and honors cancellation', async () => {
  for (const mode of ['media', 'subtitle', 'cancel']) {
    const engine = new YoutubeEngine(), seen = [], ctx = context()
    engine.runYtdlpAttempt = async (_task, _context, runtime, args) => {
      seen.push(args)
      if (mode === 'cancel') runtime.abortController.abort()
      return { exitCode: 1, detectedFinalPath: null, stderr: mode === 'subtitle'
        ? "Unable to download video subtitles for 'ar': HTTP Error 403: Forbidden"
        : 'unable to download video data: HTTP Error 403: Forbidden' }
    }
    if (mode === 'cancel') await assert.rejects(engine.download(task(), ctx), /abort/i)
    else assert.equal((await engine.download(task(), ctx)).kind, 'retryable-error')
    assert.equal(seen.length, mode === 'media' ? 2 : 1)
  }
})
