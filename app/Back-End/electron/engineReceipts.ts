import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { verifyEngine, type EngineHealth, type EngineSpec } from './engineIntegrity'

export type EngineReceipt = {
  schema: 1; name: string; filename: string; manifestIdentity: string
  sha256: string; size: number; mtimeMs: number; version: string; verifiedAt: string; executionFailed?: boolean
}
export type EngineLocation = { file: string; receipt: string; identity: string; spec: EngineSpec }
export type CachedHealth = EngineHealth & { state: 'cached-ready' | 'background-check' | 'repair-required' }
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export async function readEngineMetadata<T>(file: string): Promise<T | null> {
  try {
    if ((await fs.stat(file)).size > 64 * 1024) return null
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch { return null }
}

/** Metadata only on the fast path. All callers share one serial verification queue. */
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
      const stat = await fs.lstat(location.file)
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
      // A cached engine must not wait behind another engine's deep verification.
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
      // Legacy SHA receipts can be migrated by re-verifying their original digest.
      // Never accept an arbitrary ZIP-extracted binary by hashing it into trust.
      const expected = location.spec.sha256 || (old && (!old.manifestIdentity || old.manifestIdentity === location.identity) && digest(old.sha256) ? old.sha256 : undefined)
      if (!digest(expected)) return { name, available: false, version: '', message: `${name} trusted checksum is missing; repair required` }
      const before = await fs.lstat(location.file)
      const health = await this.verify(location.file, { ...location.spec, sha256: expected }, this.controller.signal)
      if (!health.available) { if (!this.signal.aborted) await this.invalidate(name); return health }
      const after = await fs.lstat(location.file)
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
    const stat = verifiedStat || await fs.lstat(location.file)
    const receipt: EngineReceipt = { schema: 1, name, filename: location.spec.filename, manifestIdentity: location.identity,
      sha256, size: stat.size, mtimeMs: stat.mtimeMs, version, verifiedAt: new Date().toISOString() }
    await fs.mkdir(path.dirname(location.receipt), { recursive: true })
    const tmp = `${location.receipt}.${randomUUID()}.tmp`
    try { await fs.writeFile(tmp, JSON.stringify(receipt)); await fs.rename(tmp, location.receipt) }
    finally { await fs.rm(tmp, { force: true }) }
    this.invalid.delete(name)
  }

  async invalidate(name: string): Promise<void> {
    this.invalid.add(name)
    try { const location = await this.locate(name); const receipt = await this.read(location.receipt); if (receipt) await fs.writeFile(location.receipt, JSON.stringify({ ...receipt, executionFailed: true })) } catch { /* retry on next use */ }
  }
  async stop(): Promise<void> { this.controller.abort(); await Promise.allSettled([...this.pending.values()]); await this.queue }
}
