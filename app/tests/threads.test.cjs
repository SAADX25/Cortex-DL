const { suite } = require('./register-ts.cjs')

suite('Threads URL and extraction', test => {
  const assert = require('node:assert/strict')
  const Module = require('node:module')
  const originalLoad = Module._load
  Module._load = function (request, parent, ...rest) {
    if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
    return originalLoad.call(this, request, parent, ...rest)
  }

  const { isThreadsUrl, threadsPostCode, threadsCarouselIndex, normalizeAnalysisUrl } = require('../Shared/analysisUrl.ts')
  const { parseDashManifest, parseThreadsHtml, selectThreadsDownloadPlan } = require('../Back-End/electron/services/threadsService.ts')
  const { isYtdlpUrl, threadsErrorMessage, normalizeIpcError } = require('../Front-End/src/lib/downloadHelpers.ts')
  const { translations } = require('../Front-End/src/translations.ts')

  const sampleMpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD mediaPresentationDuration="PT14.255601S">
  <Period id="0">
    <AdaptationSet id="0" contentType="video">
      <Representation id="v540" bandwidth="179354" codecs="vp09.00.30.08" mimeType="video/mp4" width="540" height="960" frameRate="15360/512" FBContentLength="319101" FBQualityLabel="540p">
        <BaseURL>https://cdn.example.test/v540.mp4?a=1&amp;b=2</BaseURL>
      </Representation>
      <Representation id="v720" bandwidth="1342557" codecs="vp09.00.31.08" mimeType="video/mp4" width="720" height="1280" frameRate="15360/512" FBContentLength="2388634" FBQualityLabel="720p">
        <BaseURL>https://cdn.example.test/v720.mp4?a=1&amp;b=2</BaseURL>
      </Representation>
      <Representation id="v1080_30" bandwidth="2163419" codecs="vp09.00.40.08" mimeType="video/mp4" width="1080" height="1920" frameRate="15360/512" FBContentLength="3849083" FBQualityLabel="960p">
        <BaseURL>https://cdn.example.test/v1080_30.mp4</BaseURL>
      </Representation>
      <Representation id="v1080_60" bandwidth="2849595" codecs="vp09.00.40.08" mimeType="video/mp4" width="1080" height="1920" frameRate="15360/256" FBContentLength="5069906" FBQualityLabel="1080p">
        <BaseURL>https://cdn.example.test/v1080_60.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
    <AdaptationSet id="1" contentType="audio">
      <Representation id="a1" bandwidth="56582" codecs="mp4a.40.5" mimeType="audio/mp4" FBContentLength="101777">
        <BaseURL>https://cdn.example.test/audio.mp4?x=1&amp;y=2</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`

  const wrapHtml = (payload, og = '') =>
    `<!doctype html><html><head>${og}</head><body><script type="application/json" data-sjs>${JSON.stringify(payload)}</script></body></html>`

  test('detects and normalizes threads.com and threads.net post URLs', () => {
    const raw = 'https://www.threads.com/@norman_ph/post/Df3TldSEiay?xmt=AQG0C2Biqoli&slof=1'
    assert.equal(isThreadsUrl(raw), true)
    assert.equal(threadsPostCode(raw), 'Df3TldSEiay')
    assert.equal(normalizeAnalysisUrl(raw), 'https://www.threads.com/@norman_ph/post/Df3TldSEiay')

    assert.equal(isThreadsUrl('https://www.threads.net/t/Df35Ch2gXOY?igsh=abc'), true)
    assert.equal(threadsPostCode('https://www.threads.net/t/Df35Ch2gXOY?igsh=abc'), 'Df35Ch2gXOY')
    assert.equal(normalizeAnalysisUrl('https://www.threads.net/t/Df35Ch2gXOY?igsh=abc'), 'https://www.threads.com/t/Df35Ch2gXOY')
    assert.equal(normalizeAnalysisUrl('https://threads.com/@user/post/ABC123/media?carousel=2&xmt=1'), 'https://www.threads.com/@user/post/ABC123?carousel=2')
    assert.equal(threadsCarouselIndex('https://www.threads.com/@user/post/ABC123?carousel=2'), 2)
    assert.equal(threadsPostCode('https://www.threads.com/@norman_ph'), null)
    assert.equal(isThreadsUrl('https://www.instagram.com/reel/DfxjiHqPX1K/'), false)

    assert.equal(isYtdlpUrl(raw), true)
    assert.equal(isYtdlpUrl('https://www.threads.net/@user/post/ABC123'), true)
  })

  test('parses MPEG-DASH manifest with portrait resolutions, frame rates, entities, and duration', () => {
    const dash = parseDashManifest(sampleMpd)
    assert.ok(Math.abs(dash.duration - 14.255601) < 0.001)
    assert.equal(dash.videos.length, 4)
    assert.equal(dash.audios.length, 1)
    const best = dash.videos.find(v => v.formatId === 'dash-v1080_60')
    assert.equal(best.qualityHeight, 1080)
    assert.equal(best.fps, 60)
    assert.equal(best.filesize, 5069906)
    assert.equal(dash.audios[0].url, 'https://cdn.example.test/audio.mp4?x=1&y=2')
    assert.equal(dash.videos[0].url, 'https://cdn.example.test/v540.mp4?a=1&b=2')
  })

  test('extracts linked_inline_media video (Instagram Reel embedded in Threads post)', () => {
    const html = wrapHtml({
      data: {
        media: {
          code: 'Df3TldSEiay',
          user: { username: 'norman_ph' },
          caption: { text: 'Club tonight 🫡\nExcited▓' },
          like_count: 6268,
          video_versions: null,
          text_post_app_info: {
            linked_inline_media: {
              code: 'DfxjiHqPX1K',
              original_width: 1080,
              original_height: 1920,
              image_versions2: { candidates: [{ url: 'https://cdn.example.test/thumb.jpg', width: 941, height: 1672 }] },
              video_versions: [
                { type: 101, url: 'https://cdn.example.test/prog720.mp4' },
                { type: 102, url: 'https://cdn.example.test/prog720.mp4' },
              ],
              video_dash_manifest: sampleMpd,
            },
          },
        },
      },
    })

    const result = parseThreadsHtml(html, 'Df3TldSEiay', 'https://www.threads.com/@norman_ph/post/Df3TldSEiay')
    assert.equal(result.kind, 'media')
    assert.equal(result.media.title, 'Club tonight 🫡 Excited')
    assert.equal(result.media.likes, 6268)
    assert.equal(result.media.thumbnail, 'https://cdn.example.test/thumb.jpg')
    assert.equal(result.media.progressiveFormats.length, 1)
    assert.ok(result.media.videoFormats.some(f => f.qualityHeight === 1080 && f.fps === 60))

    const bestPlan = selectThreadsDownloadPlan(result.media, 'mp4')
    assert.equal(bestPlan.mode, 'dash-mux')
    assert.equal(bestPlan.video.formatId, 'dash-v1080_60')
    assert.equal(bestPlan.audio.formatId, 'dash-a1')

    const plan720 = selectThreadsDownloadPlan(result.media, 'mp4', '720p')
    assert.equal(plan720.mode, 'dash-mux')
    assert.equal(plan720.video.formatId, 'dash-v720')

    const audioPlan = selectThreadsDownloadPlan(result.media, 'mp3')
    assert.equal(audioPlan.mode, 'single')
    assert.equal(audioPlan.stream.formatId, 'dash-a1')
  })

  test('extracts native video, multi-video carousel, reposted video, and voice audio', () => {
    const nativeHtml = wrapHtml({
      post: {
        code: 'Native1',
        user: { username: 'creator' },
        caption: { text: 'Native video' },
        original_width: 720,
        original_height: 1280,
        video_versions: [{ type: 101, url: 'https://cdn.example.test/native.mp4' }],
      },
    })
    const native = parseThreadsHtml(nativeHtml, 'Native1', 'https://www.threads.com/@creator/post/Native1')
    assert.equal(native.kind, 'media')
    const nativePlan = selectThreadsDownloadPlan(native.media, 'mp4')
    assert.equal(nativePlan.mode, 'single')
    assert.equal(nativePlan.stream.url, 'https://cdn.example.test/native.mp4')

    const carouselHtml = wrapHtml({
      post: {
        code: 'Car1',
        user: { username: 'multi' },
        caption: { text: 'Two clips' },
        carousel_media: [
          { image_versions2: { candidates: [{ url: 'https://cdn.example.test/photo.jpg', width: 500, height: 500 }] } },
          { video_versions: [{ type: 101, url: 'https://cdn.example.test/clip1.mp4' }], image_versions2: { candidates: [{ url: 'https://cdn.example.test/t1.jpg', width: 500, height: 500 }] } },
          { video_versions: [{ type: 101, url: 'https://cdn.example.test/clip2.mp4' }], image_versions2: { candidates: [{ url: 'https://cdn.example.test/t2.jpg', width: 500, height: 500 }] } },
        ],
      },
    })
    const playlist = parseThreadsHtml(carouselHtml, 'Car1', 'https://www.threads.com/@multi/post/Car1')
    assert.equal(playlist.kind, 'playlist')
    assert.equal(playlist.items.length, 2)
    assert.equal(playlist.items[1].url, 'https://www.threads.com/@multi/post/Car1?carousel=1')
    const secondItem = parseThreadsHtml(carouselHtml, 'Car1', 'https://www.threads.com/@multi/post/Car1?carousel=1', 1)
    assert.equal(secondItem.kind, 'media')
    assert.equal(secondItem.media.progressiveFormats[0].url, 'https://cdn.example.test/clip2.mp4')

    const repostHtml = wrapHtml({
      post: {
        code: 'Repost1',
        user: { username: 'sharer' },
        caption: { text: 'Check this out' },
        text_post_app_info: {
          share_info: {
            quoted_post: {
              code: 'Orig1',
              video_versions: [{ type: 101, url: 'https://cdn.example.test/quoted.mp4' }],
            },
          },
        },
      },
    })
    const repost = parseThreadsHtml(repostHtml, 'Repost1', 'https://www.threads.com/@sharer/post/Repost1')
    assert.equal(repost.kind, 'media')
    assert.equal(repost.media.progressiveFormats[0].url, 'https://cdn.example.test/quoted.mp4')

    const voiceHtml = wrapHtml({
      post: {
        code: 'Voice1',
        user: { username: 'speaker' },
        audio: { audio_src: 'https://cdn.example.test/voice.m4a', duration_ms: 8500 },
      },
    })
    const voice = parseThreadsHtml(voiceHtml, 'Voice1', 'https://www.threads.com/@speaker/post/Voice1')
    assert.equal(voice.kind, 'media')
    assert.equal(voice.media.duration, 8.5)
    assert.equal(voice.media.audioFormats[0].url, 'https://cdn.example.test/voice.m4a')
  })

  test('reports clear error codes for text-only and unavailable posts and maps localized messages', () => {
    const textOnlyHtml = wrapHtml({
      post: { code: 'Text1', caption: { text: 'Just text' }, video_versions: null, text_post_app_info: {} },
    })
    assert.throws(() => parseThreadsHtml(textOnlyHtml, 'Text1', 'https://www.threads.com/@u/post/Text1'), /THREADS_NO_MEDIA/)
    assert.throws(() => parseThreadsHtml('<html><body>empty</body></html>', 'Missing1', 'https://www.threads.com/@u/post/Missing1'), /THREADS_POST_UNAVAILABLE/)

    assert.equal(threadsErrorMessage(new Error('THREADS_NO_MEDIA'), translations.ar), translations.ar.threads_no_media)
    assert.equal(threadsErrorMessage(new Error('THREADS_POST_UNAVAILABLE'), translations.en), translations.en.threads_post_unavailable)
    assert.equal(normalizeIpcError(new Error('Error invoking remote method \'cortexdl:analyze-url\': Error: THREADS_INVALID_URL'), 'fallback', translations.ar), translations.ar.threads_invalid_url)
  })
})

suite('Threads download integration', test => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const http = require('node:http')
  const cp = require('node:child_process')
  const Module = require('node:module')
  const originalLoad = Module._load
  const rows = new Map()
  const mockDb = {
    db: { prepare: () => ({ get: () => undefined, run: () => {} }), transaction: fn => fn },
    taskDb: { getAllTasks: { all: () => [...rows.values()] }, upsertTask: { run: row => rows.set(row.id, { ...row }) }, deleteTask: { run: id => rows.delete(id) }, clearCompleted: { run: () => {} } },
  }
  Module._load = function (request, parent, ...rest) {
    if (request.endsWith('/engineManager')) return { ensureEnginesReady: async () => {}, engineExecutionFailed() {}, engineReceipts: { inspect: async name => ({ name, available: true, version: '2.9.4', state: 'cached-ready' }) } }
    if (request === './paths' || request === '../paths') return { getBinaryPath: name => path.join(process.cwd(), 'engine-baseline', name + '.exe'), getBinDirectory: () => path.join(process.cwd(), 'engine-baseline') }
    if (request === 'electron-log') return { info() {}, warn() {}, error() {} }
    if (request === './db' || request === '../db') return mockDb
    if (request === 'electron') return { app: { isPackaged: false, getPath: () => os.tmpdir() }, Notification: class { static isSupported() { return false } show() {} } }
    return originalLoad.call(this, request, parent, ...rest)
  }

  const { DownloadManager } = require('../Back-End/electron/downloadManager.ts')
  const { matchesMediaFormat, probeMediaFile } = require('../Back-End/electron/services/mediaService.ts')
  const bin = name => path.join(process.cwd(), 'engine-baseline', name + (process.platform === 'win32' ? '.exe' : ''))

  test('downloads and muxes Threads DASH video+audio to MP4 and converts to MP3 via YoutubeEngine delegation', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-threads-dl-'))
    const videoSrc = path.join(dir, 'video_only.mp4')
    const audioSrc = path.join(dir, 'audio_only.mp4')

    const vRes = cp.spawnSync(bin('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x128:rate=24:duration=2', '-c:v', 'libx264', '-an', videoSrc], { timeout: 30000 })
    assert.equal(vRes.status, 0, vRes.stderr?.toString())
    const aRes = cp.spawnSync(bin('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:a', 'aac', '-vn', audioSrc], { timeout: 30000 })
    assert.equal(aRes.status, 0, aRes.stderr?.toString())

    const videoBytes = await fs.readFile(videoSrc)
    const audioBytes = await fs.readFile(audioSrc)

    let server
    const originalFetch = global.fetch
    try {
      server = http.createServer((req, res) => {
        if (req.url === '/video.mp4') {
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(videoBytes.length) })
          res.end(videoBytes)
          return
        }
        if (req.url === '/audio.mp4') {
          res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Content-Length': String(audioBytes.length) })
          res.end(audioBytes)
          return
        }
        res.writeHead(404)
        res.end()
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${server.address().port}`
      const mpd = `<MPD mediaPresentationDuration="PT2S"><Period><AdaptationSet contentType="video"><Representation id="v1080" bandwidth="2000000" codecs="avc1" mimeType="video/mp4" width="1080" height="1920" frameRate="24/1" FBContentLength="${videoBytes.length}"><BaseURL>${base}/video.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation id="a1" bandwidth="64000" codecs="mp4a.40.2" mimeType="audio/mp4" FBContentLength="${audioBytes.length}"><BaseURL>${base}/audio.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`
      const mockHtml = `<html><body><script type="application/json" data-sjs>${JSON.stringify({
        data: {
          media: {
            code: 'MockPost123',
            user: { username: 'tester' },
            caption: { text: 'Mock Threads Video' },
            text_post_app_info: {
              linked_inline_media: {
                code: 'Reel123',
                original_width: 1080,
                original_height: 1920,
                video_dash_manifest: mpd,
              },
            },
          },
        },
      })}</script></body></html>`

      global.fetch = (input, init) => {
        if (String(input).includes('threads.com')) {
          return Promise.resolve(new Response(mockHtml, { status: 200, headers: { 'Content-Type': 'text/html' } }))
        }
        return originalFetch(input, init)
      }

      const manager = new DownloadManager()
      manager.schedule = () => {}

      const mp4Task = {
        id: 'threads-mp4',
        url: 'https://www.threads.com/@tester/post/MockPost123?xmt=abc&slof=1',
        directory: dir,
        filename: 'threads_out.mp4',
        filePath: path.join(dir, 'threads_out.mp4'),
        engine: 'ytdlp',
        targetFormat: 'mp4',
        status: 'queued',
        totalBytes: null,
        downloadedBytes: 0,
        speedBytesPerSec: null,
        errorMessage: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      }
      manager.tasks.set(mp4Task.id, mp4Task)
      manager.runtime.set(mp4Task.id, manager.freshRuntime())
      await manager.executeEngine(mp4Task.id)

      assert.equal(mp4Task.status, 'completed', mp4Task.errorMessage)
      assert.equal(mp4Task.title, 'Mock Threads Video')
      const mp4Probe = await probeMediaFile(mp4Task.filePath)
      assert.equal(matchesMediaFormat('mp4', mp4Probe), true)
      assert.ok(mp4Probe.streams.some(s => s.codec_type === 'video'))
      assert.ok(mp4Probe.streams.some(s => s.codec_type === 'audio'))

      const mp3Task = {
        ...mp4Task,
        id: 'threads-mp3',
        filename: 'threads_audio.mp3',
        filePath: path.join(dir, 'threads_audio.mp3'),
        targetFormat: 'mp3',
        status: 'queued',
        downloadedBytes: 0,
        totalBytes: null,
        title: undefined,
      }
      manager.tasks.set(mp3Task.id, mp3Task)
      manager.runtime.set(mp3Task.id, manager.freshRuntime())
      await manager.executeEngine(mp3Task.id)

      assert.equal(mp3Task.status, 'completed', mp3Task.errorMessage)
      const mp3Probe = await probeMediaFile(mp3Task.filePath)
      assert.equal(matchesMediaFormat('mp3', mp3Probe), true)

      manager.flushPendingSave()
    } finally {
      global.fetch = originalFetch
      if (server) await new Promise(resolve => server.close(resolve))
      await fs.rm(dir, { recursive: true, force: true })
      rows.clear()
    }
  })
})
