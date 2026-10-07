import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'

export type EngineSpec = { name: string; filename: string; minimum: string; architecture: string; sha256?: string; version?: string }
export type EngineHealth = { name: string; available: boolean; version: string; message: string }
export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function verifyEngine(file: string, spec: EngineSpec): Promise<EngineHealth> {
  const fail = (message: string): EngineHealth => ({ name: spec.name, available: false, version: '', message })
  try {
    const stat = await fs.promises.lstat(file)
    if (!stat.isFile() || stat.size < 100_000 || stat.size > 350 * 1024 * 1024) return fail(`${spec.name} executable is corrupt`)
    if (spec.sha256 && await sha256(file) !== spec.sha256) return fail(`${spec.name} checksum is invalid`)
    if (process.platform === 'win32') {
      const handle = await fs.promises.open(file, 'r')
      try {
        const header = Buffer.alloc(64); await handle.read(header, 0, 64, 0)
        if (header.readUInt16LE(0) !== 0x5a4d) return fail(`${spec.name} is not a Windows executable`)
        const pe = Buffer.alloc(6); await handle.read(pe, 0, 6, header.readUInt32LE(60))
        if (pe.readUInt32LE(0) !== 0x4550 || (spec.architecture === 'x64' && pe.readUInt16LE(4) !== 0x8664)) return fail(`${spec.name} architecture is incompatible`)
      } finally { await handle.close() }
    }
    const output = await new Promise<string>((resolve, reject) => {
      execFile(file, [spec.name === 'ffmpeg' || spec.name === 'ffprobe' ? '-version' : '--version'], { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 }, (err, stdout) => err ? reject(err) : resolve(stdout))
    })
    const match = spec.name === 'yt-dlp' ? /^(\d{4}\.\d{2}\.\d{2})/m.exec(output) : /(?:version |deno )(\d+\.\d+(?:\.\d+)?|N-\d+)/.exec(output)
    if (!match) return fail(`${spec.name} version is unrecognized`)
    const version = match[1]
    if (!version.startsWith('N-')) {
      const actual = version.split('.').map(Number), minimum = spec.minimum.split('.').map(Number)
      for (let i = 0; i < minimum.length; i++) {
        if ((actual[i] || 0) > minimum[i]) break
        if ((actual[i] || 0) < minimum[i]) return fail(`${spec.name} version ${version} is unsupported (requires ${spec.minimum})`)
      }
    } else {
      const codec = /libavcodec\s+(\d+)/.exec(output)
      if (!codec || Number(codec[1]) < 60) return fail(`${spec.name} development version is unsupported`)
    }
    if (spec.version && version !== spec.version) return fail(`${spec.name} version does not match its manifest`)
    return { name: spec.name, available: true, version, message: 'Healthy' }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return fail(code === 'ENOENT' ? `${spec.name} executable is missing` : `${spec.name} cannot launch or be read (${code || 'verification failed'})`)
  }
}

/** HTTPS only, bounded headers, idle time, overall duration, redirects and bytes. */
export async function downloadEngine(url: string, destination: string, expectedHash?: string, signal?: AbortSignal, onProgress?: (received: number, total: number | null) => void): Promise<void> {
  const tmp = `${destination}.${randomUUID()}.tmp`
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    // Large FFmpeg packages can take several minutes on a healthy slow link.
    // Abort stalled transfers, rather than restarting an active download at 3 minutes.
    const timer = setTimeout(abort, 30 * 60_000)
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const touch = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(abort, 60_000)
    }
    try {
      let response: Response | undefined
      let next = url
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (new URL(next).protocol !== 'https:') throw new Error('Engine downloads require HTTPS')
        const headerTimer = setTimeout(abort, 15_000)
        try { response = await fetch(next, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'Cortex-DL' } }) }
        finally { clearTimeout(headerTimer) }
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        const location = response.headers.get('location'); await response.body?.cancel()
        if (!location || redirects === 5) throw new Error('Too many engine download redirects')
        next = new URL(location, next).href
      }
      if (!response?.ok || !response.body) throw new Error(`Engine download HTTP ${response?.status}`)
      const maximum = 350 * 1024 * 1024
      if (Number(response.headers.get('content-length')) > maximum) { await response.body.cancel(); throw new Error('Engine download is too large') }
      const length = Number(response.headers.get('content-length'))
      const total = Number.isFinite(length) && length > 0 ? length : null
      let size = 0, reportedAt = 0
      onProgress?.(0, total)
      touch()
      const bound = new Transform({ transform(chunk, _enc, cb) {
        touch()
        size += chunk.length
        if (Date.now() - reportedAt >= 100) { onProgress?.(size, total); reportedAt = Date.now() }
        cb(size > maximum ? new Error('Engine download exceeds size limit') : null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream), bound, fs.createWriteStream(tmp, { flags: 'wx' }), { signal: controller.signal })
      clearTimeout(idleTimer)
      onProgress?.(size, total)
      if (expectedHash && await sha256(tmp) !== expectedHash) throw new Error('Engine download checksum mismatch')
      await fs.promises.rename(tmp, destination)
      return
    } catch (error) {
      await fs.promises.rm(tmp, { force: true })
      if (signal?.aborted || attempt === 2) throw error
    } finally { clearTimeout(timer); clearTimeout(idleTimer); signal?.removeEventListener('abort', abort) }
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
  }
}

/** Candidate is verified before touching the old engine, then validated after promotion. */
export async function promoteEngine(candidate: string, final: string, spec: EngineSpec): Promise<void> {
  const check = await verifyEngine(candidate, spec)
  if (!check.available) throw new Error(check.message)
  const backup = `${final}.previous`
  const hadOld = fs.existsSync(final)
  await fs.promises.rm(backup, { force: true })
  if (hadOld) await fs.promises.rename(final, backup)
  try {
    await fs.promises.rename(candidate, final)
    const installed = await verifyEngine(final, spec)
    if (!installed.available) throw new Error(installed.message)
  } catch (error) {
    await fs.promises.rm(final, { force: true })
    if (hadOld) await fs.promises.rename(backup, final)
    throw error
  }
  await fs.promises.rm(backup, { force: true })
}

/** Extract only allowlisted regular files, never archive paths, links, or directories. */
export async function extractEngineZip(zip: string, destination: string, filenames: string[]): Promise<void> {
  if ((await fs.promises.stat(zip)).size > 350 * 1024 * 1024) throw new Error('Archive is too large')
  // adm-zip reads/inflates synchronously. Keep it off Electron's main event loop.
  const require = createRequire(path.join(process.env.APP_ROOT || process.cwd(), 'package.json'))
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(String.raw`
      const { parentPort, workerData } = require('node:worker_threads');
      const fs = require('node:fs'); const path = require('node:path');
      const AdmZip = require(workerData.zipModule);
      (async () => {
        const entries = new AdmZip(workerData.zip).getEntries();
        if (entries.length > 5000) throw new Error('Archive contains too many entries');
        let expanded = 0; const found = new Set();
        for (const entry of entries) {
          const parts = entry.entryName.replace(/\\/g, '/').split('/');
          if (parts.includes('..') || path.isAbsolute(entry.entryName) || /^[A-Za-z]:/.test(entry.entryName) || entry.entryName.includes('\0')) throw new Error('Unsafe archive path');
          expanded += entry.header.size;
          if (expanded > 1024 * 1024 * 1024) throw new Error('Archive expands beyond size limit');
          const name = parts[parts.length - 1];
          if (!workerData.filenames.includes(name)) continue;
          if (entry.isDirectory || ((entry.header.attr >>> 16) & 0xf000) === 0xa000 || found.has(name) || entry.header.size > 350 * 1024 * 1024) throw new Error('Invalid engine archive entry');
          found.add(name);
          await fs.promises.writeFile(path.join(workerData.destination, name), entry.getData(), { flag: 'wx' });
        }
        if (found.size !== workerData.filenames.length) throw new Error('Required executable missing from archive');
        parentPort.postMessage('done');
      })().catch(error => { throw error });
    `, { eval: true, workerData: { zip, destination, filenames, zipModule: require.resolve('adm-zip') } })
    const timer = setTimeout(() => { void worker.terminate().then(() => reject(new Error('Engine archive extraction timed out'))) }, 120_000)
    let completed = false
    worker.once('message', () => { completed = true; clearTimeout(timer); resolve() })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('exit', code => { clearTimeout(timer); if (!completed) reject(new Error(`Engine archive worker exited before completion (${code})`)) })
  })
}
