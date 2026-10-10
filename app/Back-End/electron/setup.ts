import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import { getBaselineDirectory, getBinDirectory } from './paths'
import { verifyEngine, promoteEngine, downloadEngine, extractEngineZip, sha256, type EngineSpec, type EngineHealth } from './engineIntegrity'
import lock from '../../engines.lock.json'
import { engineReceipts, engineNames } from './engineReadiness'
import { startupDuration } from './startupTiming'
export interface SetupState {
  status: 'checking' | 'cached-ready' | 'background-check' | 'ready' | 'repair-required' | 'repairing' | 'degraded' | 'fatal'
  progress: number
  message: string
}
export let setupState: SetupState = { status: 'background-check', progress: 0, message: 'Checking engine receipts…' }
const specs: EngineSpec[] = lock.packages.flatMap(pkg => pkg.engines)
/** Health/settings/diagnostics are metadata-only; they never start engines. */
export async function engineHealth(): Promise<EngineHealth[]> {
  return Promise.all(engineNames.map(name => engineReceipts.inspect(name)))
}
function sendState(win: BrowserWindow, state: SetupState): void {
  setupState = state
  if (!win.isDestroyed()) win.webContents.send('cortexdl:setup-progress', state)
}
export function reportEngineFailure(win: BrowserWindow, message: string): void {
  sendState(win, { status: 'repair-required', progress: 0, message })
}
export async function checkCachedEngines(win: BrowserWindow): Promise<void> {
  const started = performance.now()
  const health = await engineHealth()
  startupDuration('cheapEngineCheckMs', started)
  const missing = health.filter(engine => 'state' in engine && engine.state === 'repair-required')
  sendState(win, missing.length ? { status: 'repair-required', progress: 0, message: missing.map(engine => engine.message).join('; ') }
    : health.every(engine => engine.available) ? { status: 'cached-ready', progress: 100, message: 'Ready' }
    : { status: 'background-check', progress: 0, message: 'Verifying changed engines in the background…' })
}
let pending: Promise<void> | null = null
export async function stopSetup(): Promise<void> { await pending?.catch(() => {}) }
export function runSetup(win: BrowserWindow, allowNetwork = true, force = false): Promise<void> {
  if (pending) return pending
  pending = setup(win, allowNetwork, force).finally(() => { pending = null })
  return pending
}
async function setup(win: BrowserWindow, allowNetwork: boolean, force: boolean): Promise<void> {
  const send = (state: SetupState) => {
    sendState(win, state)
  }
  let component = 'filesystem'
  try {
    send({ status: force ? 'repairing' : 'background-check', progress: 0, message: 'Verifying changed engines…' })
    const bin = getBinDirectory()
    await fs.promises.mkdir(bin, { recursive: true })
    for (const spec of specs) {
      engineReceipts.signal.throwIfAborted()
      const file = path.join(bin, spec.filename)
      if (!fs.existsSync(file) && fs.existsSync(`${file}.previous`)) await fs.promises.rename(`${file}.previous`, file)
    }
    const started = performance.now()
    const health: EngineHealth[] = []
    for (const spec of specs) {
      health.push(await engineReceipts.ensure(spec.name, force))
      // Yield between large binaries and allow foreground work to run.
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    startupDuration('backgroundEngineCheckMs', started)
    for (let i = 0; i < lock.packages.length; i++) {
      const pkg = lock.packages[i]
      const missing = pkg.engines.filter(spec => !health.find(engine => engine.name === spec.name)?.available)
      if (!missing.length) continue
      engineReceipts.signal.throwIfAborted()
      component = pkg.name
      send({ status: 'repairing', progress: 40, message: 'Preparing Cortex-DL Engines…' })
      const progress = 40 + i / lock.packages.length * 45
      const baseline = getBaselineDirectory()
      const stage = await fs.promises.mkdtemp(path.join(bin, 'repair-'))
      try {
        // Development can reuse the local verified baseline; installers contain no engines.
        let bundled: EngineSpec[] = []
        try { bundled = JSON.parse(await fs.promises.readFile(path.join(baseline, 'manifest.json'), 'utf8')).engines } catch { /* first run downloads pinned packages */ }
        const needsDownload: EngineSpec[] = []
        for (const spec of missing) {
          const entry = bundled.find(engine => engine.name === spec.name)
          if (entry?.sha256 && (entry as EngineSpec & { packageSha256?: string }).packageSha256 === pkg.sha256 && (await verifyEngine(path.join(baseline, spec.filename), entry, engineReceipts.signal)).available) {
            await fs.promises.copyFile(path.join(baseline, spec.filename), path.join(stage, spec.filename))
          } else needsDownload.push(spec)
        }
        if (needsDownload.length) {
          if (!allowNetwork) throw new Error('Engine download requires an internet connection')
          const archive = path.join(stage, 'package.download')
          let startedAt = Date.now()
          log.info('[Engines] Download started', pkg.name)
          await downloadEngine(pkg.url, archive, pkg.sha256, engineReceipts.signal, (received, total) => {
            if (received === 0) startedAt = Date.now()
            const mb = (received / 1024 / 1024).toFixed(1)
            const elapsed = (Date.now() - startedAt) / 1000
            const rate = elapsed >= 1 ? received / elapsed : 0
            const speed = rate > 0 ? ` · ${rate >= 1024 * 1024 ? `${(rate / 1024 / 1024).toFixed(1)} MB/s` : `${(rate / 1024).toFixed(0)} KB/s`}` : ''
            const seconds = total && rate > 0 ? Math.ceil(Math.max(0, total - received) / rate) : null
            const eta = seconds !== null ? ` · ${Math.floor(seconds / 60)}m ${seconds % 60}s remaining` : ''
            send({ status: 'repairing', progress: progress + (total ? received / total : 0) * 35 / lock.packages.length, message: `Downloading ${pkg.name}: ${mb} MB${total ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ''}${speed}${eta}…` })
          })
          log.info('[Engines] Download completed', pkg.name, { elapsedMs: Date.now() - startedAt, bytes: (await fs.promises.stat(archive)).size })
          send({ status: 'repairing', progress: progress + 35 / lock.packages.length, message: `Extracting and verifying ${pkg.name}…` })
          if (pkg.url.endsWith('.zip')) await extractEngineZip(archive, stage, pkg.engines.map(e => e.filename), engineReceipts.signal)
          else await fs.promises.copyFile(archive, path.join(stage, pkg.engines[0].filename))
        }
        for (const spec of missing) {
          const candidate = path.join(stage, spec.filename)
          const entry = { ...spec, sha256: await sha256(candidate, engineReceipts.signal) }
          await promoteEngine(candidate, path.join(bin, spec.filename), entry, engineReceipts.signal)
          const installed = await verifyEngine(path.join(bin, spec.filename), entry, engineReceipts.signal)
          if (!installed.available) throw new Error(installed.message)
          await engineReceipts.record(spec.name, installed.version, entry.sha256)
          log.info('[Engines] Installed', spec.name)
        }
      } finally { await fs.promises.rm(stage, { recursive: true, force: true }) }
    }
    send({ status: health.every(e => e.available) ? 'background-check' : 'repairing', progress: 90, message: 'Completing engine setup…' })
    const result = health.every(e => e.available) ? health : await engineHealth()
    if (result.some(engine => !engine.available)) throw new Error('Post-repair verification failed')
    log.info('[Engines] Healthy', result)
    send({ status: 'ready', progress: 100, message: 'Ready' })
  } catch (error) {
    log.error('[Setup]', component, error)
    const code = (error as NodeJS.ErrnoException).code || (error as { cause?: NodeJS.ErrnoException }).cause?.code
    const http = /HTTP (\d{3})/.exec(String(error))
    const reason = http ? `Network download failed (HTTP ${http[1]}). Retry later.` : code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' ? 'Network unavailable. Check your connection and retry.' : code === 'ENOSPC' ? 'Disk is full.' : code === 'EACCES' || code === 'EPERM' ? 'Folder is not writable or security software blocked access.' : 'Engine installation failed. Check your internet connection and retry.'
    send({ status: 'repair-required', progress: 0, message: `${component}: ${reason} Retry repair or open diagnostics.` })
    throw error
  }
}
