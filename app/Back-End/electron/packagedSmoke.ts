import { app, dialog, type BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { db } from './db'
import { engineHealth } from './setup'
import { buildInfo } from './diagnostics'
import { getBinaryPath } from './paths'
import { isDirectMedia } from './directAnalysis'
import { extractEngineZip } from './engineIntegrity'
import type { DownloadManager } from './downloadManager'

const wait = async (condition: () => boolean) => {
  for (let i = 0; i < 600; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw new Error('Packaged smoke timed out')
}
export async function runPackagedSmoke(win: BrowserWindow, downloads: DownloadManager, directory: string, port: number, token: string, stats: () => { streams: number; ffmpegProcesses: number; probeProcesses: number }): Promise<void> {
  const started = Date.now()
  assert.equal(app.isPackaged, true, 'Smoke must run packaged executable')
  const build = buildInfo()
  assert.equal(app.getVersion(), build.version)
  const engines = await engineHealth()
  assert.ok(engines.every(engine => engine.available), JSON.stringify(engines))
  for (const engine of engines) {
    assert.ok(!getBinaryPath(engine.name).includes('app.asar'))
    assert.ok((await fs.stat(getBinaryPath(engine.name))).isFile())
  }
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal')
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok')
  const second = await fs.access(path.join(directory, 'first-run.json')).then(() => true, () => false)
  if (second) {
    assert.ok(downloads.list().some(task => task.title === 'Packaged fixture'), 'Task must survive restart')
    const savedLibrary = await win.webContents.executeJavaScript('window.cortexDl.listMediaLibrary()')
    assert.ok(savedLibrary.some((item: { kind: string }) => item.kind === 'video') && savedLibrary.some((item: { kind: string }) => item.kind === 'audio'), 'Media library must survive restart')
    const covered = savedLibrary.find((item: { kind: string; artwork?: string }) => item.kind === 'audio' && item.artwork)
    assert.ok(covered, 'Manual song cover must survive restart')
    assert.equal(covered.artworkEmbedded, true, 'Embedded cover state must survive restart')
    const savedCover = await win.webContents.executeJavaScript(`window.cortexDl.getMediaLibraryThumbnail(${JSON.stringify(covered.id)})`)
    assert.ok(savedCover?.startsWith('data:image/jpeg;base64,'), 'Saved cover must load without the original image')
  }
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node')
  assert.ok((await fs.stat(unpacked)).size > 0, 'Native N-API module must be unpacked')
  const { default: AdmZip } = await import('adm-zip')
  const archive = new AdmZip()
  archive.addFile('bundle/fixture.exe', Buffer.alloc(1024 * 1024, 42))
  const extraction = await fs.mkdtemp(path.join(directory, 'zip-worker-'))
  try {
    const zip = path.join(extraction, 'fixture.zip')
    archive.writeZip(zip)
    await extractEngineZip(zip, extraction, ['fixture.exe'])
    assert.equal((await fs.stat(path.join(extraction, 'fixture.exe'))).size, 1024 * 1024)
  } finally { await fs.rm(extraction, { recursive: true, force: true }) }
  const fixture = path.join(directory, 'fixture.mp4')
  const english = path.join(directory, 'smoke.en.vtt'), arabic = path.join(directory, 'smoke.ar.vtt')
  await fs.writeFile(english, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.900\nEnglish smoke caption\n')
  await fs.writeFile(arabic, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.900\nترجمة عربية للاختبار\n')
  await new Promise<void>((resolve, reject) => execFile(getBinaryPath('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2',
    '-i', english, '-i', arabic, '-map', '0:v', '-map', '1:a', '-map', '2:0', '-map', '3:0',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-c:s', 'mov_text',
    '-metadata:s:s:0', 'language=eng', '-metadata:s:s:1', 'language=ara', fixture], { windowsHide: true, timeout: 30000 }, err => err ? reject(err) : resolve()))
  // Outside every download root: library imports must grant only these files.
  const externalDirectory = `${directory}-library`
  await fs.mkdir(externalDirectory, { recursive: true })
  const audio = path.join(externalDirectory, 'صوت خارج التنزيلات.mp3')
  await new Promise<void>((resolve, reject) => execFile(getBinaryPath('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=duration=3', '-c:a', 'libmp3lame', audio], { windowsHide: true, timeout: 20000 }, err => err ? reject(err) : resolve()))
  const unregisteredAudio = path.join(externalDirectory, 'unregistered.mp3')
  await fs.copyFile(audio, unregisteredAudio)
  const data = await fs.readFile(fixture)
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': data.length }); if (req.method === 'HEAD') res.end(); else res.end(data) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as import('node:net').AddressInfo
    const url = `http://127.0.0.1:${address.port}/fixture.mp4`
    assert.equal(await isDirectMedia(url, new AbortController().signal), true)
    const task = await downloads.add({ url, directory, filename: `fixture-download-${Date.now()}.mp4`, engine: 'direct', targetFormat: 'mp4', title: 'Packaged fixture' })
    await wait(() => ['completed', 'error'].includes(downloads.get(task.id)?.status || ''))
    const completed = downloads.get(task.id)!
    assert.equal(completed.status, 'completed', completed.errorMessage || undefined)
    assert.ok(completed.filePath)
    await fs.writeFile(path.join(directory, path.parse(completed.filePath!).name + '.fr.srt'), '1\n00:00:00,000 --> 00:00:01,900\nSous-titre français\n')
    downloads.flushPendingSave()
    const mediaUrl = `http://127.0.0.1:${port}/?token=${token}&path=${encodeURIComponent(completed.filePath!)}&session=smoke`
    const denied = await fetch(mediaUrl.replace(token, 'bad'))
    assert.equal(denied.status, 401); await denied.body?.cancel()
    const range = await fetch(mediaUrl, { headers: { Range: 'bytes=0-63' } })
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 64)
    const externalUrl = (file: string) => `http://127.0.0.1:${port}/?token=${token}&path=${encodeURIComponent(file)}&session=external-library`
    assert.equal((await fetch(externalUrl(audio), { method: 'HEAD' })).status, second ? 200 : 403, 'External media requires a persisted library reference')
    await wait(() => !win.webContents.isLoading())
    const renderer = await win.webContents.executeJavaScript(`(async () => {
      for(let i=0;i<100;i++){ if(window.__cortexSmokeLifecycle)break; await new Promise(r=>setTimeout(r,50)) }
      if (!window.cortexDl || !window.__cortexSmokeLifecycle) throw new Error('Preload/renderer unavailable')
      const info=await window.cortexDl.getBuildInfo()
      const lifecycle=await window.__cortexSmokeLifecycle(${JSON.stringify(completed.filePath)}, ${JSON.stringify(audio)}, ${JSON.stringify(mediaUrl)})
      return { info, lifecycle, version: document.body.textContent.includes(${JSON.stringify(build.version)}) }
    })()`)
    assert.equal(renderer.info.version, build.version)
    assert.equal(renderer.version, true, 'Renderer About version mismatch')
    assert.ok(renderer.lifecycle)
    assert.equal((await fetch(externalUrl(audio), { method: 'HEAD' })).status, 200, 'Imported external audio must be allowed')
    const audioRange = await fetch(externalUrl(audio), { headers: { Range: 'bytes=0-63' } })
    assert.equal(audioRange.status, 206); assert.equal(audioRange.headers.get('content-type'), 'audio/mpeg'); assert.equal((await audioRange.arrayBuffer()).byteLength, 64)
    assert.equal((await fetch(externalUrl(unregisteredAudio), { method: 'HEAD' })).status, 403, 'Import must not grant sibling files')
    const cover = path.join(externalDirectory, 'chosen-cover.png')
    await new Promise<void>((resolve, reject) => execFile(getBinaryPath('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=purple:size=360x480', '-frames:v', '1', cover], { windowsHide: true, timeout: 20000 }, err => err ? reject(err) : resolve()))
    const originalDialog = dialog.showOpenDialog
    let coveredId: string
    try {
      // Exercise the protected preload/IPC picker using only the smoke fixture.
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [cover] })) as typeof dialog.showOpenDialog
      coveredId = await win.webContents.executeJavaScript(`(async () => {
        const item = (await window.cortexDl.listMediaLibrary()).find(item => item.filePath === ${JSON.stringify(audio)})
        if (!item) throw new Error('Smoke audio missing')
        const saved = await window.cortexDl.selectMediaLibraryArtwork(item.id)
        if (!saved?.find(entry => entry.id === item.id)?.artworkEmbedded) throw new Error('Manual cover was not embedded')
        const video = saved.find(entry => entry.filePath === ${JSON.stringify(completed.filePath)})
        if (!video) throw new Error('Smoke library video missing')
        await window.cortexDl.selectMediaLibraryArtwork(video.id)
        const videoCover = await window.cortexDl.getMediaLibraryArtworkInfo(video.id)
        if (!videoCover.embedded || !videoCover.thumbnail) throw new Error('MP4 cover was not embedded or detected')
        await window.cortexDl.removeMediaLibraryArtwork(video.id)
        const removedCover = await window.cortexDl.getMediaLibraryArtworkInfo(video.id)
        if (removedCover.embedded || !removedCover.thumbnail) throw new Error('MP4 cover removal did not restore the video frame preview')
        if (!await window.__cortexSmokeArtwork(${JSON.stringify(completed.filePath)}, false)) throw new Error('MP4 player cover edit failed')
        if (!await window.__cortexSmokeArtwork(${JSON.stringify(audio)}, true)) throw new Error('Audio player cover edit failed')
        return item.id
      })()`)
    } finally { dialog.showOpenDialog = originalDialog }
    await fs.unlink(cover)
    const savedCover = await win.webContents.executeJavaScript(`window.cortexDl.getMediaLibraryThumbnail(${JSON.stringify(coveredId)})`)
    assert.ok(savedCover?.startsWith('data:image/jpeg;base64,'), 'Manual cover must remain after deleting the original image')
    const embedded = await new Promise<string>((resolve, reject) => execFile(getBinaryPath('ffprobe'), ['-v', 'error', '-show_streams', '-of', 'json', audio], { windowsHide: true, timeout: 20000 }, (err, stdout) => err ? reject(err) : resolve(stdout)))
    assert.ok(JSON.parse(embedded).streams.some((stream: { disposition?: { attached_pic?: number } }) => stream.disposition?.attached_pic === 1), 'The actual MP3 must contain an attached cover')
    await wait(() => { const resource = stats(); return resource.streams === 0 && resource.ffmpegProcesses === 0 && resource.probeProcesses === 0 })
    await fs.writeFile(path.join(directory, second ? 'second-run.json' : 'first-run.json'), JSON.stringify({ runtimeReadyAt: Date.now() - process.uptime() * 1000, smokeDurationMs: Date.now() - started, build, engines, electron: process.versions.electron, abi: process.versions.modules, napi: process.versions.napi, restored: second, checks: ['boot', 'ZIP worker', 'setup animation', 'setup progress', 'trim sound', 'preload', 'version', 'sqlite WAL', 'native unpacked', 'engines', 'direct analysis', 'direct download', 'media library import/playback/persistence', '1080p 30fps playback', 'embedded English/Arabic and external SRT cues', 'subtitle language selection/on/off/seek/pause', 'media token', 'range', 'video x10', 'audio x20', 'Visual Trim x20'], stats: stats() }, null, 2))
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}
