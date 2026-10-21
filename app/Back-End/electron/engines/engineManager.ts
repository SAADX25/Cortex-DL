import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { setPriority, constants as osConstants } from 'node:os'
import log from 'electron-log'
import lock from '../../../engines.lock.json'
import { getBaselineDirectory, getBinaryPath, getBinDirectory } from '../paths'

export type EngineSpec = { name: string; filename: string; minimum: string; architecture: string; sha256?: string; version?: string }

export type EngineHealth = { name: string; available: boolean; version: string; message: string }

export const verificationMetrics = { subprocesses: 0, hashReads: 0, bytesHashed: 0 }

export async function sha256(file: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  verificationMetrics.hashReads++
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file, { signal })) {
    verificationMetrics.bytesHashed += chunk.length
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export async function verifyEngine(file: string, spec: EngineSpec, signal?: AbortSignal): Promise<EngineHealth> {
  const fail = (message: string): EngineHealth => ({ name: spec.name, available: false, version: '', message })
  try {
    signal?.throwIfAborted()
    const stat = await fs.promises.lstat(file)
    if (!stat.isFile() || stat.size < 100_000 || stat.size > 350 * 1024 * 1024) return fail(`${spec.name} executable is corrupt`)
    if (spec.sha256 && await sha256(file, signal) !== spec.sha256) return fail(`${spec.name} checksum is invalid`)
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
      signal?.throwIfAborted()
      verificationMetrics.subprocesses++
      const child = execFile(file, [spec.name === 'ffmpeg' || spec.name === 'ffprobe' ? '-version' : '--version'], { signal, windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 }, (err, stdout) => err ? reject(err) : resolve(stdout))
      child.once('spawn', () => { try { if (child.pid) setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL) } catch (error) { log.debug('[Engine priority]', error) } })
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

export class EngineDownloadHttpError extends Error {
  constructor(readonly status: number) {
    super(`Engine download HTTP ${status}`)
    this.name = 'EngineDownloadHttpError'
  }
}

export async function downloadEngine(url: string, destination: string, expectedHash?: string, signal?: AbortSignal, onProgress?: (received: number, total: number | null) => void): Promise<void> {
  const tmp = `${destination}.${randomUUID()}.tmp`
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()

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
      if (!response) throw new Error('Engine download returned no response')
      if (!response.ok) {
        await response.body?.cancel()
        throw new EngineDownloadHttpError(response.status)
      }
      if (!response.body) throw new Error('Engine download returned an empty body')
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
      if (signal?.aborted || attempt === 2 || (error instanceof EngineDownloadHttpError && ![408, 429].includes(error.status) && error.status < 500)) throw error
    } finally { clearTimeout(timer); clearTimeout(idleTimer); signal?.removeEventListener('abort', abort) }
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
  }
}

export async function promoteEngine(candidate: string, final: string, spec: EngineSpec, signal?: AbortSignal): Promise<void> {
  const check = await verifyEngine(candidate, spec, signal)
  if (!check.available) throw new Error(check.message)
  const backup = `${final}.previous`
  const hadOld = fs.existsSync(final)
  await fs.promises.rm(backup, { force: true })
  if (hadOld) await fs.promises.rename(final, backup)
  try {
    await fs.promises.rename(candidate, final)
    const installed = await verifyEngine(final, spec, signal)
    if (!installed.available) throw new Error(installed.message)
  } catch (error) {
    await fs.promises.rm(final, { force: true })
    if (hadOld) await fs.promises.rename(backup, final)
    throw error
  }
  await fs.promises.rm(backup, { force: true })
}

export async function extractEngineZip(zip: string, destination: string, filenames: string[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if ((await fs.promises.stat(zip)).size > 350 * 1024 * 1024) throw new Error('Archive is too large')

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
    const abort = () => {
      clearTimeout(timer)
      void worker.terminate().then(() => reject(new Error('Engine archive extraction cancelled')))
    }
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    worker.once('message', () => { completed = true; cleanup(); resolve() })
    worker.once('error', error => { cleanup(); reject(error) })
    worker.once('exit', code => { cleanup(); if (!completed) reject(new Error(`Engine archive worker exited before completion (${code})`)) })
  })
}

export type EngineReceipt = {
  schema: 1; name: string; filename: string; manifestIdentity: string
  sha256: string; size: number; mtimeMs: number; version: string; verifiedAt: string; executionFailed?: boolean
}

export type EngineLocation = { file: string; receipt: string; identity: string; spec: EngineSpec }

export type CachedHealth = EngineHealth & { state: 'cached-ready' | 'background-check' | 'repair-required' }

const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export async function readEngineMetadata<T>(file: string): Promise<T | null> {
  try {
    if ((await fs.promises.stat(file)).size > 64 * 1024) return null
    return JSON.parse(await fs.promises.readFile(file, 'utf8'))
  } catch { return null }
}

export class EngineReceipts {
  private pending = new Map<string, Promise<EngineHealth>>()
  private queue: Promise<unknown> = Promise.resolve()
  private invalid = new Set<string>()
  private forceRequested = new Set<string>()
  private controller = new AbortController()
  constructor(private locate: (name: string) => Promise<EngineLocation>,
    private verify = verifyEngine) {}

  get signal(): AbortSignal { return this.controller.signal }

  async inspect(name: string): Promise<CachedHealth> {
    const fail = (state: CachedHealth['state'], message: string): CachedHealth => ({ name, available: false, version: '', state, message })
    try {
      const location = await this.locate(name)
      const stat = await fs.promises.lstat(location.file)
      if (!stat.isFile()) return fail('repair-required', `${name} executable is unavailable`)
      const receipt = await this.read(location.receipt)
      if (!this.invalid.has(name) && receipt?.schema === 1 && !receipt.executionFailed && receipt.name === name && receipt.filename === location.spec.filename
        && receipt.manifestIdentity === location.identity && digest(receipt.sha256)
        && (!location.spec.sha256 || location.spec.sha256 === receipt.sha256)
        && typeof receipt.version === 'string' && receipt.version.length > 0
        && (!location.spec.version || location.spec.version === receipt.version)
        && Number.isFinite(Date.parse(receipt.verifiedAt)) && receipt.size === stat.size && receipt.mtimeMs === stat.mtimeMs) {
        return { name, available: true, version: receipt.version, state: 'cached-ready', message: 'Verified receipt unchanged' }
      }
      return fail('background-check', `${name} needs verification`)
    } catch (error) {
      return fail('repair-required', `${name} cannot be read (${(error as NodeJS.ErrnoException).code || 'verification failed'})`)
    }
  }

  private async read(file: string): Promise<EngineReceipt | null> {
    return readEngineMetadata<EngineReceipt>(file)
  }

  ensure(name: string, force = false): Promise<EngineHealth> {
    if (force) this.forceRequested.add(name)
    const existing = this.pending.get(name)
    if (existing) return existing
    const work = (async (): Promise<EngineHealth> => {
      const cached = await this.inspect(name)
      if (!force && !this.forceRequested.has(name) && cached.state !== 'background-check') return cached

      const verification = this.queue.then(() => this.deepVerify(name, force))
      this.queue = verification.catch(() => {})
      return verification
    })().finally(() => { this.pending.delete(name); this.forceRequested.delete(name) })
    this.pending.set(name, work)
    return work
  }

  private async deepVerify(name: string, force: boolean): Promise<EngineHealth> {
    force ||= this.forceRequested.has(name)
    const cached = await this.inspect(name)
    if (!force && cached.state !== 'background-check') return cached
    try {
      this.controller.signal.throwIfAborted()
      const location = await this.locate(name)
      const old = await this.read(location.receipt)

      const expected = location.spec.sha256 || (old && (!old.manifestIdentity || old.manifestIdentity === location.identity) && digest(old.sha256) ? old.sha256 : undefined)
      if (!digest(expected)) return { name, available: false, version: '', message: `${name} trusted checksum is missing; repair required` }
      const before = await fs.promises.lstat(location.file)
      const health = await this.verify(location.file, { ...location.spec, sha256: expected }, this.controller.signal)
      if (!health.available) { if (!this.signal.aborted) await this.invalidate(name); return health }
      const after = await fs.promises.lstat(location.file)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Engine changed during verification')
      await this.record(name, health.version, expected, after)
      return health
    } catch (error) {
      if (!this.signal.aborted) await this.invalidate(name)
      return { name, available: false, version: '', message: `${name} verification failed (${String(error)})` }
    }
  }

  async record(name: string, version: string, sha256: string, verifiedStat?: { size: number; mtimeMs: number }): Promise<void> {
    const location = await this.locate(name)
    const stat = verifiedStat || await fs.promises.lstat(location.file)
    const receipt: EngineReceipt = { schema: 1, name, filename: location.spec.filename, manifestIdentity: location.identity,
      sha256, size: stat.size, mtimeMs: stat.mtimeMs, version, verifiedAt: new Date().toISOString() }
    await fs.promises.mkdir(path.dirname(location.receipt), { recursive: true })
    const tmp = `${location.receipt}.${randomUUID()}.tmp`
    try { await fs.promises.writeFile(tmp, JSON.stringify(receipt)); await fs.promises.rename(tmp, location.receipt) }
    finally { await fs.promises.rm(tmp, { force: true }) }
    this.invalid.delete(name)
  }

  async invalidate(name: string): Promise<void> {
    this.invalid.add(name)
    try { const location = await this.locate(name); const receipt = await this.read(location.receipt); if (receipt) await fs.promises.writeFile(location.receipt, JSON.stringify({ ...receipt, executionFailed: true })) } catch (error) { log.warn('[Engine receipt invalidation]', error) }
  }
  async stop(): Promise<void> { this.controller.abort(); await Promise.allSettled([...this.pending.values()]); await this.queue }
}

let reportFailure: (message: string) => void = () => {}

export function onEngineFailure(handler: (message: string) => void): void { reportFailure = handler }

export const engineNames = lock.packages.flatMap(pkg => pkg.engines.map(spec => spec.name))

export const engineReceipts = new EngineReceipts(async (name): Promise<EngineLocation> => {
  const pkg = lock.packages.find(pkg => pkg.engines.some(spec => spec.name === name))
  const spec: EngineSpec | undefined = pkg?.engines.find(spec => spec.name === name)
  if (!pkg || !spec) throw new Error(`Unknown engine ${name}`)
  const file = getBinaryPath(name)
  const receipt = path.join(getBinDirectory(), `${spec.filename}.integrity.json`)
  const identity = JSON.stringify({ schema: lock.schema, platform: lock.platform, architecture: lock.architecture, package: pkg, spec })
  let expected: EngineSpec = { ...spec, version: spec.version || (/^N-/.test(pkg.version) ? /^N-\d+/.exec(pkg.version)?.[0] : pkg.version) }
  if (path.dirname(file) === getBaselineDirectory()) {
    try {
      const baseline = await readEngineMetadata<{ engines: (EngineSpec & { packageSha256?: string })[] }>(path.join(getBaselineDirectory(), 'manifest.json'))
      const entry = baseline?.engines.find(entry => entry.name === name)
      if (entry?.packageSha256 !== pkg.sha256 || !entry.sha256) throw new Error('Untrusted baseline')
      expected = { ...expected, ...entry }
    } catch {
      expected.sha256 = 'untrusted-baseline'
    }
  } else {
    const saved = await readEngineMetadata<EngineReceipt>(receipt)
      if (saved?.manifestIdentity === identity && name === 'yt-dlp' && saved.version >= (spec.version || '')) {
      expected = { ...expected, sha256: saved.sha256, version: saved.version }
    }

    if (name === 'yt-dlp' && !expected.sha256) expected.sha256 = pkg.sha256
  }
  return { file, receipt, identity, spec: expected }
})

export async function ensureEnginesReady(names: string[]): Promise<void> {
  for (const name of names) {
    const health = await engineReceipts.ensure(name)
    if (!health.available) {
      log.error('[Engines] First use blocked', health)
      reportFailure(health.message)
      throw new Error(`${health.message}. Use Repair Engines.`)
    }
  }
}

export function engineExecutionFailed(name: string, error: unknown): void {
  const code = (error as NodeJS.ErrnoException)?.code
  if (['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC', 'UNKNOWN'].includes(code || '')) {
    void engineReceipts.invalidate(name).catch(error => log.error('[Engines] Invalidation failed', error))
    reportFailure(`${name} cannot launch (${code}). Use Repair Engines.`)
  }
}

export async function engineHealth(): Promise<EngineHealth[]> {
  return Promise.all(engineNames.map(name => engineReceipts.inspect(name)))
}

