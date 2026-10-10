require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const os = require('node:os')
const originalLoad = Module._load
const cookies = ['--cookies', 'synthetic-cookies.txt']
const calls = []
let subtitlePlan
let reusableMedia = false
let fixtureWarnings = ''
let extract = async () => info(1080)
function info(height) {
  return JSON.stringify({ title: 'Fixture', formats: [{ format_id: String(height), height, vcodec: 'avc1', acodec: 'none' }],
    automatic_captions: { ar: [{ name: 'Arabic' }] } })
}
Module._load = function(request, parent, ...rest) {
  if (request === '../youtubeMediaCache') return {
    findCompletedYouTubeMedia: async () => reusableMedia ? 'fixture.mp4' : null,
    rememberCompletedYouTubeMedia: async () => {},
  }
  if (request === './cookieSession' || request === '../cookieSession') return { withCookieSession: async (args, signal, run) => { signal?.throwIfAborted(); return run(args) } }
  if (request === './engineReadiness' || request === '../engineReadiness') return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
  if (request === 'electron-log') return { info(){}, warn(){}, error(){} }
  if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir() } }
  if (request === './db') return { db: { prepare: () => ({ get: () => ({ value: cookies[1] }) }) } }
  if (request === './paths' || request === '../paths') return { getBinaryPath: () => process.execPath, getBinDirectory: () => os.tmpdir() }
  if (request === './cookieValidation') return { CookieValidationCache: class {
    async validate(filePath) { return { valid: true, filePath } }
    fingerprint(filePath) { return filePath }
  } }
  if (request === './analysisProcess') return { extractAnalysis: async (_binary, args, signal, _bytes, _timeout, diagnostics) => {
    signal.throwIfAborted(); calls.push(args); const output = await extract(args); diagnostics?.(fixtureWarnings); return output
  } }
  if (request === './previewExtraction') return { PREVIEW_FORMAT: 'best', TRIM_PREVIEW_FORMAT: 'bestvideo+bestaudio',
    extractPreview: async (_binary, args) => { calls.push(args); return extract(args) },
    extractPreviewStreams: async (_binary, args) => { calls.push(args); return extract(args) } }
  if (request === '../mediaFiles' && parent.filename.endsWith('YoutubeEngine.ts')) return {
    findTaskMediaFile: async () => 'fixture.mp4',
    probeMediaFile: async () => { if (!reusableMedia) throw new Error('No completed cached media'); return { streams: [{ codec_type: 'video', height: 1080 }] } },
  }
  if (request === '../youtubeSubtitles' && parent.filename.endsWith('YoutubeEngine.ts')) return {
    prepareYouTubeSubtitle: (...args) => subtitlePlan(...args), embedYouTubeSubtitle: async () => 'fixture.subtitled.mkv',
  }
  return originalLoad.call(this, request, parent, ...rest)
}
const { youtubeErrorCode, isYouTubeAuthRequiredError, isYouTubeUrl } = require('../Shared/youtubeErrors.ts')
const { withYouTubeCookieFallback } = require('../Back-End/electron/youtubeAccess.ts')
const { analyzeWithYtdlp, refreshYouTubeCaptions, getDirectStreamUrl, getTrimPreviewStreams } = require('../Back-End/electron/ytdlp.ts')
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
  assert.deepEqual(seen, [[]], 'YouTube cookies must never be sent to another provider')
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

test('YouTube first analysis initializes Deno and retains warnings with no client overrides', async () => {
  calls.length = 0
  extract = async () => info(1440)
  const result = await analyzeWithYtdlp('https://youtu.be/runtimefix1')
  assert.equal(result.formats[0].height, 1440)
  assert.equal(calls[0].includes('--js-runtimes'), true)
  assert.equal(calls[0].includes('--no-warnings'), false)
  assert.equal(calls[0].includes('--ignore-config'), true)
  assert.equal(calls[0].includes('--extractor-args'), false)
})

test('YouTube independent caption failures preserve cached public formats and bound 429 refreshes', async () => {
  calls.length = 0
  const url = 'https://youtu.be/captionfix1'
  extract = async () => info(1080)
  const original = await analyzeWithYtdlp(url)
  extract = async args => {
    assert.equal(args.includes('--skip-download'), true)
    assert.equal(args.includes('--ignore-no-formats-error'), true)
    throw new Error('Unable to download subtitles: HTTP Error 429')
  }
  const captions = await refreshYouTubeCaptions(url, new AbortController().signal)
  assert.equal(captions.state, 'rate-limited')
  assert.equal(calls.length, 2)
  assert.deepEqual(await refreshYouTubeCaptions(url, new AbortController().signal), captions)
  assert.equal(calls.length, 2, 'cooldown prevents extra extractor requests')
  const cached = await analyzeWithYtdlp(url)
  assert.deepEqual(cached.subtitles, original.subtitles)
  assert.equal(cached.formats[0].height, 1080)
})

test('YouTube caption discovery can use an authorized session without replacing public quality', async () => {
  calls.length = 0
  extract = async args => {
    if (!args.includes('--cookies')) throw new Error('LOGIN_REQUIRED')
    return info(360)
  }
  const result = await refreshYouTubeCaptions('https://youtu.be/authsubsfix', new AbortController().signal)
  assert.equal(result.state, 'available')
  assert.equal(result.subtitles[0].languageCode, 'ar')
  assert.equal(calls.length, 2)
})

test('YouTube caption authentication warning followed by rejected cookies makes only one account attempt', async () => {
  calls.length = 0
  fixtureWarnings = 'ERROR: LOGIN_REQUIRED'
  try {
    extract = async args => {
      if (args.includes('--cookies')) throw new Error('LOGIN_REQUIRED')
      return JSON.stringify({ subtitles: {}, automatic_captions: {} })
    }
    const result = await refreshYouTubeCaptions('https://youtu.be/subsreject1', new AbortController().signal)
    assert.equal(result.state, 'restricted')
    assert.equal(calls.length, 2)
    assert.equal(calls.filter(args => args.includes('--cookies')).length, 1)
  } finally { fixtureWarnings = '' }
})

test('YouTube caption discovery retains manual preference and distinguishes missing from blocked', () => {
  const { discoverCaptions, captionFailure } = require('../Back-End/electron/captionDiscovery.ts')
  const result = discoverCaptions({ subtitles: { en: [{ name: 'English' }] }, automatic_captions: {
    en: [{ name: 'English auto' }], 'en-US': [{ name: 'English (US)' }], ar: [{ name: 'Arabic' }], empty: [] } })
  assert.equal(result.state, 'available')
  assert.equal(result.subtitles.find(s => s.languageCode === 'en').isAutomatic, false)
  assert.equal(result.subtitles.find(s => s.languageCode === 'en-US').isAutomatic, true)
  assert.equal(discoverCaptions({ subtitles: {}, automatic_captions: {} }).state, 'none-confirmed')
  assert.equal(discoverCaptions({}).state, 'unknown')
  assert.equal(discoverCaptions({ subtitles: {}, automatic_captions: {} }, 'ERROR: LOGIN_REQUIRED').state, 'restricted')
  assert.equal(captionFailure('HTTP Error 429').state, 'rate-limited')
  assert.equal(captionFailure('Failed to resolve host').state, 'unknown')
})

test('YouTube classifier requires actual PO token diagnostics and never treats generic cookie advice as authentication', () => {
  for (const [message, code] of [
    ['ERROR: Failed to resolve host; use --cookies-from-browser or --cookies', 'YOUTUBE_NETWORK_ERROR'],
    ['WARNING: GVS PO Token not provided; formats require a PO Token', 'YOUTUBE_PO_TOKEN_REQUIRED'],
    ['WARNING: formats have been skipped as they are missing a url', 'YOUTUBE_FORMATS_RESTRICTED'],
    ['HTTP Error 403', null], ['Use --cookies-from-browser or --cookies', null],
  ]) assert.equal(youtubeErrorCode(message), code)
})

test('YouTube manual and automatic caption extraction use separate arguments and bounded retries', () => {
  const engine = new YoutubeEngine()
  for (const automatic of [true, false]) {
    const args = engine.buildYtdlpArgs({ ...task(), subtitleLanguage: 'en-US', subtitleIsAutomatic: automatic }, 'bestVideo', { ffmpegDir: os.tmpdir() }, context().runtime)
    assert.equal(args.includes('--write-auto-subs'), automatic)
    assert.equal(args.includes('--write-subs'), !automatic)
    assert.equal(args[args.indexOf('--retries') + 1], '0')
    assert.equal(args[args.indexOf('--sub-langs') + 1], 'en-US')
    assert.match(args[args.indexOf('-f') + 1], /bestvideo.*\+bestaudio/)
    assert.equal(args.includes('--merge-output-format'), true)
  }
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
    status: 'downloading', ytdlpFormatId: '1080p' }
}
function context() { return { runtime: { abortController: null, child: null, retries: 0 }, sendUpdate(){}, saveState(){} } }

test('YouTube download keeps selected quality without sending cookies on public success', async () => {
  const engine = new YoutubeEngine(), seen = []
  engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
    seen.push(args); return { exitCode: 0, detectedFinalPath: 'fixture.mp4', stderr: '' }
  }
  assert.equal((await engine.download(task(), context())).kind, 'success')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].includes('--cookies'), false)
  assert.match(seen[0][seen[0].indexOf('-f') + 1], /height<=1080/)
})

test('YouTube public media omits generic provider credentials while other providers retain explicit login', () => {
  const engine = new YoutubeEngine(), login = { ...task(), username: 'fixture-user', password: 'fixture-password' }
  const publicArgs = engine.buildYtdlpArgs(login, 'bestVideo', { ffmpegDir: os.tmpdir() }, context().runtime)
  assert.equal(publicArgs.includes('--username'), false)
  assert.equal(publicArgs.includes('--password'), false)
  const providerArgs = engine.buildYtdlpArgs({ ...login, url: 'https://vimeo.com/123' }, 'bestVideo', { ffmpegDir: os.tmpdir() }, context().runtime)
  assert.equal(providerArgs.includes('--username'), true)
  assert.equal(providerArgs.includes('--password'), true)
  assert.equal(providerArgs.includes('--cookies'), false)
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
      ['YOUTUBE_RATE_LIMITED', messages.youtube_rate_limited], ['YOUTUBE_SUBTITLE_RATE_LIMITED', messages.youtube_subtitle_rate_limited],
      ['YOUTUBE_SUBTITLE_UNAVAILABLE', messages.youtube_subtitle_unavailable]]) {
      assert.equal(youtubeErrorMessage(code, messages), message)
      assert.equal(normalizeIpcError(new Error(`Error invoking remote method 'analyze': Error: ${code}`), 'fallback', messages), message)
    }
    assert.equal(normalizeIpcError('HTTP Error 429: Too Many Requests', 'fallback', messages), messages.youtube_rate_limited)
    assert.equal(normalizeIpcError('', 'fallback', messages), 'fallback')
  }
})

test('YouTube media 403 tries public HLS once with the same quality', async () => {
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
})

test('YouTube keeps media and HLS public then extracts subtitles independently before embedding', async () => {
  const engine = new YoutubeEngine(), seen = []
  subtitlePlan = async (_task, configured, signal, run) => {
    signal.throwIfAborted()
    assert.deepEqual(configured, cookies)
    const result = await run(cookies)
    assert.equal(result.exitCode, 0)
    return 'fixture.ar.vtt'
  }
  engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
    seen.push(args)
    return { exitCode: seen.length === 1 ? 1 : 0, detectedFinalPath: 'fixture.mp4',
      stderr: seen.length === 1 ? 'unable to download video data: HTTP Error 403: Forbidden' : '' }
  }
  const result = await engine.download({ ...task(), subtitleLanguage: 'ar', subtitleIsAutomatic: true }, context())
  assert.deepEqual(result, { kind: 'success', candidate: 'fixture.subtitled.mkv' })
  assert.equal(seen.length, 3)
  assert.equal(seen[2].includes('--skip-download'), true)
  assert.equal(seen[2].includes('--no-progress'), true, 'caption bytes must not count as video progress')
  assert.equal(seen[2].includes('--cookies'), true)
  assert.equal(seen[2].includes('--write-auto-subs'), true)
  assert.equal(seen[2].includes('--embed-subs'), false)
  assert.equal(seen[2][seen[2].indexOf('--sub-format') + 1], 'vtt')
  for (const args of seen.slice(0, 2)) {
    assert.equal(args.includes('--cookies'), false)
    assert.equal(args.includes('--write-auto-subs'), false)
    assert.equal(args.includes('--embed-subs'), false)
    assert.match(args[args.indexOf('-f') + 1], /height<=1080/)
  }
})

test('YouTube retains media for subtitle-only retry but never approves missing requested captions', async () => {
  const engine = new YoutubeEngine()
  subtitlePlan = async () => { throw new Error('YOUTUBE_SUBTITLE_RATE_LIMITED') }
  let mediaCalls = 0
  engine.runYtdlpAttempt = async () => { mediaCalls++; return { exitCode: 0, detectedFinalPath: 'fixture.mp4', stderr: '' } }
  assert.deepEqual(await engine.download({ ...task(), subtitleLanguage: 'ar' }, context()),
    { kind: 'fatal-error', message: 'YOUTUBE_SUBTITLE_RATE_LIMITED' })
  assert.equal(mediaCalls, 1)
})

test('YouTube subtitle-only retry reuses completed media without another media extraction', async () => {
  reusableMedia = true
  try {
    const engine = new YoutubeEngine()
    subtitlePlan = async () => 'fixture.ar.vtt'
    engine.runYtdlpAttempt = async () => { throw new Error('Completed media must not be requested again') }
    assert.deepEqual(await engine.download({ ...task(), subtitleLanguage: 'ar' }, context()),
      { kind: 'success', candidate: 'fixture.subtitled.mkv' })
  } finally { reusableMedia = false }
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
    else assert.equal((await engine.download(task(), ctx)).kind, 'fatal-error')
    assert.equal(seen.length, mode === 'media' ? 2 : 1)
  }
})
