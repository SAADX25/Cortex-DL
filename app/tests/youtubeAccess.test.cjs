require('./register-ts.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const os = require('node:os')
const originalLoad = Module._load
const calls = []
let fixtureWarnings = ''
let extract = async () => info(1080)
function info(height) {
  return JSON.stringify({ title: 'Fixture', formats: [{ format_id: String(height), height, vcodec: 'avc1', acodec: 'none' }],
    automatic_captions: { ar: [{ name: 'Arabic' }] } })
}
Module._load = function(request, parent, ...rest) {
  if (request === './engineReadiness' || request === '../engineReadiness') return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
  if (request === 'electron-log') return { info(){}, warn(){}, error(){} }
  if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir() } }
  if (request === './paths' || request === '../paths') return { getBinaryPath: () => process.execPath, getBinDirectory: () => os.tmpdir() }
  if (request === './analysisProcess') return { extractAnalysis: async (_binary, args, signal, _bytes, _timeout, diagnostics) => {
    signal.throwIfAborted(); calls.push(args); const output = await extract(args); diagnostics?.(fixtureWarnings); return output
  } }
  if (request === './previewExtraction') return { PREVIEW_FORMAT: 'best', TRIM_PREVIEW_FORMAT: 'bestvideo+bestaudio',
    extractPreview: async (_binary, args) => { calls.push(args); return extract(args) },
    extractPreviewStreams: async (_binary, args) => { calls.push(args); return extract(args) } }
  if (request === '../mediaFiles' && parent.filename.endsWith('YoutubeEngine.ts')) return {
    findTaskMediaFile: async () => 'fixture.mp4',
  }
  return originalLoad.call(this, request, parent, ...rest)
}
const { youtubeErrorCode, isYouTubeAuthRequiredError, isYouTubeUrl } = require('../Shared/youtubeErrors.ts')
const { analyzeWithYtdlp, assertAnalysisAllowed, getDirectStreamUrl, getTrimPreviewStreams } = require('../Back-End/electron/ytdlp.ts')
const { YoutubeEngine } = require('../Back-End/electron/engines/YoutubeEngine.ts')
const { normalizeIpcError, youtubeErrorMessage } = require('../Front-End/src/lib/downloadHelpers.ts')
const { translations } = require('../Front-End/src/translations.ts')

test('YouTube 429 is never reported as authentication, including generic login advice', () => {
  const subtitle = "ERROR: HTTP Error 429: Too Many Requests. Sign in to confirm you are not a bot"
  for (const error of [subtitle, new Error(subtitle), { stderr: subtitle }, new Error('Failed', { cause: new Error(subtitle) })]) {
    assert.equal(youtubeErrorCode(error), 'YOUTUBE_RATE_LIMITED')
    assert.equal(isYouTubeAuthRequiredError(error), false)
  }
  assert.equal(youtubeErrorCode('HTTP Error 429. Use --cookies-from-browser or --cookies'), 'YOUTUBE_RATE_LIMITED')
  assert.equal(youtubeErrorCode('Sign in to confirm you are not a bot'), 'YOUTUBE_BOT_VERIFICATION')
  assert.equal(youtubeErrorCode('HTTP Error 403: Forbidden'), null)
})

test('YouTube public policy validates exact hostnames', () => {
 assert.equal(isYouTubeUrl('https://www.youtube.com/watch?v=abcdefghijk'),true);
 assert.equal(isYouTubeUrl('https://youtube.com.evil.invalid/watch?v=abcdefghijk'),false);
 assert.equal(isYouTubeUrl('https://example.invalid/?url=youtube.com'),false);
})

test('YouTube analysis preserves 1080p when configured cookies would expose only 360p', async () => {
  calls.length = 0
  extract = async args => info(args.includes('--cookies') ? 360 : 1080)
  const result = await analyzeWithYtdlp('https://youtu.be/publicfix01')
  assert.equal(result.formats[0].height, 1080)
  assert.equal(Object.hasOwn(result, 'subtitles'), false)
  assert.equal(Object.hasOwn(result, 'captionDiscovery'), false)
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

test('YouTube classifier requires actual PO token diagnostics and never treats generic cookie advice as authentication', () => {
  for (const [message, code] of [
    ['ERROR: Failed to resolve host; use --cookies-from-browser or --cookies', 'YOUTUBE_NETWORK_ERROR'],
    ['WARNING: GVS PO Token not provided; formats require a PO Token', 'YOUTUBE_PO_TOKEN_REQUIRED'],
    ['WARNING: formats have been skipped as they are missing a url', 'YOUTUBE_FORMATS_RESTRICTED'],
    ['HTTP Error 403', null], ['Use --cookies-from-browser or --cookies', null],
  ]) assert.equal(youtubeErrorCode(message), code)
})

test('YouTube analysis reports private content without retrying an account',async()=>{
 calls.length=0;extract=async()=>{throw new Error('Sign in to confirm your age')};
 await assert.rejects(analyzeWithYtdlp('https://youtu.be/privatefix1'),/YOUTUBE_AUTH_REQUIRED/);
 assert.equal(calls.length,1);assert.ok(!calls[0].includes('--cookies'));
})

test('YouTube analysis 429 makes one request and does not switch to cookies', async () => {
  calls.length = 0
  extract = async () => { throw new Error('HTTP Error 429: Too Many Requests; use --cookies-from-browser or --cookies') }
  await assert.rejects(analyzeWithYtdlp('https://youtu.be/limitedfix1'), /YOUTUBE_RATE_LIMITED/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].includes('--cookies'), false)
})

test('YouTube previews propagate sign-in without account retries',async()=>{
 for(const preview of [getDirectStreamUrl,getTrimPreviewStreams]){
 calls.length=0;extract=async()=> 'https://fixture.invalid/video';await preview('https://youtu.be/previewfix1');assert.equal(calls.length,1);
 calls.length=0;extract=async()=>{throw new Error('LOGIN_REQUIRED')};await assert.rejects(preview('https://youtu.be/previewfix1'),/YOUTUBE_AUTH_REQUIRED/);assert.equal(calls.length,1);}
})

test('YouTube public analysis honors pre-canceled requests',async()=>{
 calls.length=0;const controller=new AbortController();controller.abort();await assert.rejects(analyzeWithYtdlp('https://youtu.be/cancelfix01',controller.signal),/abort/i);assert.equal(calls.length,0);
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

test('YouTube download fails once for authentication and request throttling', async () => {
  for (const failure of ['LOGIN_REQUIRED', 'HTTP Error 429: Too Many Requests']) {
    const engine = new YoutubeEngine(), seen = []
    engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
      seen.push(args); return { exitCode: 1, detectedFinalPath: null, stderr: failure }
    }
    const result = await engine.download(task(), context())
    assert.deepEqual(result, { kind: 'fatal-error', message: failure === 'LOGIN_REQUIRED' ? 'YOUTUBE_AUTH_REQUIRED' : 'YOUTUBE_RATE_LIMITED' })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].includes('--cookies'), false)
  }
})

test('Arabic and English errors distinguish bot verification, request throttling and viewing permission', () => {
  for (const messages of Object.values(translations)) {
    for (const [code, message] of [['YOUTUBE_AUTH_REQUIRED', messages.youtube_auth_required],
      ['YOUTUBE_RATE_LIMITED', messages.youtube_rate_limited],
      ['YOUTUBE_BOT_VERIFICATION', messages.youtube_bot_verification]]) {
      assert.equal(youtubeErrorMessage(code, messages), message)
      assert.equal(normalizeIpcError(new Error(`Error invoking remote method 'analyze': Error: ${code}`), 'fallback', messages), message)
    }
    assert.equal(normalizeIpcError('HTTP Error 429: Too Many Requests', 'fallback', messages), messages.youtube_rate_limited)
    assert.equal(normalizeIpcError('', 'fallback', messages), 'fallback')
  }
})

test('YouTube bot verification is reported separately, without caption advice or repeated analysis requests', async () => {
  calls.length = 0
  extract = async () => { throw new Error("Sign in to confirm you're not a bot. Use --cookies") }
  const url = 'https://youtu.be/botfixture1'
  await assert.rejects(analyzeWithYtdlp(url), /YOUTUBE_BOT_VERIFICATION/)
  await assert.rejects(analyzeWithYtdlp('https://www.youtube.com/watch?v=botfixture1&si=shared&t=10'), /YOUTUBE_BOT_VERIFICATION/)
  assert.throws(() => assertAnalysisAllowed('https://www.youtube.com/shorts/botfixture1'), /YOUTUBE_BOT_VERIFICATION/)
  await assert.rejects(analyzeWithYtdlp(url), /YOUTUBE_BOT_VERIFICATION/)
  assert.equal(calls.length, 1)
  for (const messages of Object.values(translations)) {
    assert.equal(normalizeIpcError(new Error('YOUTUBE_BOT_VERIFICATION'), 'fallback', messages), messages.youtube_bot_verification)
    assert.equal(normalizeIpcError('DOWNLOAD_RETRY_REQUIRED', 'fallback', messages), messages.download_retry_required)
    assert.doesNotMatch(messages.youtube_bot_verification, /Subtitles|ترجمات|ترجمة|cookies/i)
  }
})

test('YouTube video engine ignores obsolete subtitle selections even when passed by legacy callers', async () => {
  const engine = new YoutubeEngine(), seen = []
  engine.runYtdlpAttempt = async (_task, _context, _runtime, args) => {
    seen.push(args); return { exitCode: 0, detectedFinalPath: 'fixture.mp4', stderr: '' }
  }
  assert.deepEqual(await engine.download({ ...task(), subtitleLanguage: 'ar', subtitleIsAutomatic: true }, context()), { kind: 'success', candidate: 'fixture.mp4' })
  assert.equal(seen.length, 1)
  for (const flag of ['--write-auto-subs', '--write-subs', '--sub-langs', '--embed-subs', '--cookies']) assert.equal(seen[0].includes(flag), false)
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

test('YouTube HLS fallback is bounded and honors cancellation', async () => {
  for (const mode of ['media', 'cancel']) {
    const engine = new YoutubeEngine(), seen = [], ctx = context()
    engine.runYtdlpAttempt = async (_task, _context, runtime, args) => {
      seen.push(args)
      if (mode === 'cancel') runtime.abortController.abort()
      return { exitCode: 1, detectedFinalPath: null, stderr: 'unable to download video data: HTTP Error 403: Forbidden' }
    }
    if (mode === 'cancel') await assert.rejects(engine.download(task(), ctx), /abort/i)
    else assert.equal((await engine.download(task(), ctx)).kind, 'fatal-error')
    assert.equal(seen.length, mode === 'media' ? 2 : 1)
  }
})
