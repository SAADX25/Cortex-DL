import { app, type BrowserWindow } from 'electron'
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
  if (second) assert.ok(downloads.list().some(task => task.title === 'Packaged fixture'), 'Task must survive restart')
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
  await new Promise<void>((resolve, reject) => execFile(getBinaryPath('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-c:a', 'aac', fixture], { windowsHide: true, timeout: 20000 }, err => err ? reject(err) : resolve()))
  const audio = path.join(directory, 'fixture.wav')
  await new Promise<void>((resolve, reject) => execFile(getBinaryPath('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', audio], { windowsHide: true, timeout: 20000 }, err => err ? reject(err) : resolve()))
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
    downloads.flushPendingSave()
    const mediaUrl = `http://127.0.0.1:${port}/?token=${token}&path=${encodeURIComponent(completed.filePath!)}&session=smoke`
    const denied = await fetch(mediaUrl.replace(token, 'bad'))
    assert.equal(denied.status, 401); await denied.body?.cancel()
    const range = await fetch(mediaUrl, { headers: { Range: 'bytes=0-63' } })
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 64)
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
    await wait(() => { const resource = stats(); return resource.streams === 0 && resource.ffmpegProcesses === 0 && resource.probeProcesses === 0 })
    await fs.writeFile(path.join(directory, second ? 'second-run.json' : 'first-run.json'), JSON.stringify({ runtimeReadyAt: Date.now() - process.uptime() * 1000, smokeDurationMs: Date.now() - started, build, engines, electron: process.versions.electron, abi: process.versions.modules, napi: process.versions.napi, restored: second, checks: ['boot', 'ZIP worker', 'setup animation', 'setup progress', 'trim sound', 'preload', 'version', 'sqlite WAL', 'native unpacked', 'engines', 'direct analysis', 'direct download', 'ffmpeg fixture', 'media token', 'range', 'video x10', 'audio x20', 'Visual Trim x20'], stats: stats() }, null, 2))
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}
