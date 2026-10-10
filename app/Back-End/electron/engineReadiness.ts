import path from 'node:path'
import log from 'electron-log'
import lock from '../../engines.lock.json'
import { getBaselineDirectory, getBinaryPath, getBinDirectory } from './paths'
import { EngineReceipts, readEngineMetadata, type EngineReceipt, type EngineLocation } from './engineReceipts'
import type { EngineSpec } from './engineIntegrity'
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
      // Still return the receipt path, so a missing binary's execution failure
      // is persisted. This sentinel can never establish cached or hashed trust.
      expected.sha256 = 'untrusted-baseline'
    }
  } else {
    // Explicit updater receipts retain their authenticated release digest/version
    // until the locked manifest changes. Legacy receipts still require a deep check.
    try {
      const saved = await readEngineMetadata<EngineReceipt>(receipt)
      if (saved?.manifestIdentity === identity && name === 'yt-dlp' && saved.version >= (spec.version || '')) {
        expected = { ...expected, sha256: saved.sha256, version: saved.version }
      }
    } catch { /* missing or malformed receipt */ }
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

/** Only OS launch failures invalidate trust; normal provider/media errors do not. */
export function engineExecutionFailed(name: string, error: unknown): void {
  const code = (error as NodeJS.ErrnoException)?.code
  if (['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC', 'UNKNOWN'].includes(code || '')) {
    void engineReceipts.invalidate(name).catch(error => log.error('[Engines] Invalidation failed', error))
    reportFailure(`${name} cannot launch (${code}). Use Repair Engines.`)
  }
}
