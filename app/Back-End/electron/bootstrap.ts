import log from 'electron-log'
import lock from '../../engines.lock.json'
import { getBaselineDirectory, getBinDirectory } from './paths'
import { verifyEngine, promoteEngine, downloadEngine, extractEngineZip, sha256, engineReceipts, engineNames, engineHealth, type EngineSpec, type EngineHealth } from './engines/engineManager'
import { app, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { initializeDiagnostics } from './diagnostics'
import { performance } from 'node:perf_hooks'

const marker = path.join(app.getPath('userData'), 'startup-state.json')

export let previousStartupFailed = false

try { previousStartupFailed = JSON.parse(fs.readFileSync(marker, 'utf8')).state === 'starting' } catch { previousStartupFailed = false }

export const safeMode = process.argv.includes('--safe-mode')

if (safeMode) app.disableHardwareAcceleration()

initializeDiagnostics()

export const gotTheLock = app.requestSingleInstanceLock()

export function markStartup(state: 'starting' | 'ready' | 'clean-shutdown'): void {
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(`${marker}.tmp`, JSON.stringify({ state, timestamp: new Date().toISOString() }))
    fs.renameSync(`${marker}.tmp`, marker)
  } catch (error) { console.warn('[Startup marker]', error) }
}

if (gotTheLock) markStartup('starting')

export const startupTimings: Record<string, number> = {}


export function startupMark(name: string): void {
  startupTimings[name] = Math.round(process.uptime() * 1000)
}

export function startupDuration(name: string, start: number): void { startupTimings[name] = Math.round((performance.now() - start) * 100) / 100 }

export async function afterUiReady(ui: Promise<unknown>, job: () => Promise<void>, failed: (error: unknown) => void): Promise<void> {
  try { await ui; await job() } catch (error) { failed(error) }
}

export interface SetupState {
  status: 'checking' | 'cached-ready' | 'background-check' | 'ready' | 'repair-required' | 'repairing' | 'degraded' | 'fatal'
  progress: number
  message: string
}

export let setupState: SetupState = { status: 'background-check', progress: 0, message: 'Checking engine receipts…' }

const specs: EngineSpec[] = lock.packages.flatMap(pkg => pkg.engines)


function sendState(win: BrowserWindow, state: SetupState): void {
  setupState = state
  if (!win.isDestroyed()) win.webContents.send('cortexdl:setup-progress', state)
}

export function reportEngineFailure(win: BrowserWindow, message: string): void {
  sendState(win, { status: 'repair-required', progress: 0, message })
}

export async function checkCachedEngines(win: BrowserWindow): Promise<void> {
  const health = await engineHealth()
  const missing = health.filter(engine => 'state' in engine && engine.state === 'repair-required')
  sendState(win, missing.length ? { status: 'repair-required', progress: 0, message: missing.map(engine => engine.message).join('; ') }
    : health.every(engine => engine.available) ? { status: 'cached-ready', progress: 100, message: 'Ready' }
    : { status: 'background-check', progress: 0, message: 'Verifying changed engines in the background…' })
}

const setupServices = {
  receipts: engineReceipts,
  binDirectory: getBinDirectory,
  baselineDirectory: getBaselineDirectory,
  verify: verifyEngine,
  download: downloadEngine,
  promote: promoteEngine,
  extract: extractEngineZip,
  hash: sha256,
}

let pending: Promise<void> | null = null

export async function stopSetup(): Promise<void> { await pending?.catch(() => {}) }

export function runSetup(win: BrowserWindow, allowNetwork = true, force = false, services = setupServices): Promise<void> {
  if (pending) return pending
  pending = setup(win, allowNetwork, force, services).finally(() => { pending = null })
  return pending
}

async function setup(win: BrowserWindow, allowNetwork: boolean, force: boolean, services: typeof setupServices): Promise<void> {
  const { receipts, binDirectory, baselineDirectory, verify, download, promote, extract, hash } = services
  const send = (state: SetupState) => {
    sendState(win, state)
  }
  let component = 'filesystem'
  try {
    send({ status: force ? 'repairing' : 'background-check', progress: 0, message: 'Verifying changed engines…' })
    const bin = binDirectory()
    await fs.promises.mkdir(bin, { recursive: true })
    for (const spec of specs) {
      receipts.signal.throwIfAborted()
      const file = path.join(bin, spec.filename)
      if (!fs.existsSync(file) && fs.existsSync(`${file}.previous`)) await fs.promises.rename(`${file}.previous`, file)
    }
    const health: EngineHealth[] = []
    for (const spec of specs) {
      health.push(await receipts.ensure(spec.name, force))

      await new Promise<void>(resolve => setImmediate(resolve))
    }
    for (let i = 0; i < lock.packages.length; i++) {
      const pkg = lock.packages[i]
      const missing = pkg.engines.filter(spec => !health.find(engine => engine.name === spec.name)?.available)
      if (!missing.length) continue
      receipts.signal.throwIfAborted()
      component = pkg.name
      send({ status: 'repairing', progress: 40, message: 'Preparing Cortex-DL Engines…' })
      const progress = 40 + i / lock.packages.length * 45
      const baseline = baselineDirectory()
      const stage = await fs.promises.mkdtemp(path.join(bin, 'repair-'))
      try {
        let bundled: EngineSpec[] = []
        try { bundled = JSON.parse(await fs.promises.readFile(path.join(baseline, 'manifest.json'), 'utf8')).engines } catch { bundled = [] }
        const needsDownload: EngineSpec[] = []
        for (const spec of missing) {
          const entry = bundled.find(engine => engine.name === spec.name)
          if (entry?.sha256 && (entry as EngineSpec & { packageSha256?: string }).packageSha256 === pkg.sha256 && (await verify(path.join(baseline, spec.filename), entry, receipts.signal)).available) {
            await fs.promises.copyFile(path.join(baseline, spec.filename), path.join(stage, spec.filename))
          } else needsDownload.push(spec)
        }
        if (needsDownload.length) {
          if (!allowNetwork) throw new Error('Engine download requires an internet connection')
          const archive = path.join(stage, 'package.download')
          let startedAt = Date.now()
          log.info('[Engines] Download started', pkg.name)
          await download(pkg.url, archive, pkg.sha256, receipts.signal, (received, total) => {
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
          if (pkg.url.endsWith('.zip')) await extract(archive, stage, pkg.engines.map(e => e.filename), receipts.signal)
          else await fs.promises.copyFile(archive, path.join(stage, pkg.engines[0].filename))
        }
        for (const spec of missing) {
          const candidate = path.join(stage, spec.filename)
          const entry = { ...spec, sha256: await hash(candidate, receipts.signal) }
          await promote(candidate, path.join(bin, spec.filename), entry, receipts.signal)
          const installed = await verify(path.join(bin, spec.filename), entry, receipts.signal)
          if (!installed.available) throw new Error(installed.message)
          await receipts.record(spec.name, installed.version, entry.sha256)
          log.info('[Engines] Installed', spec.name)
        }
      } finally { await fs.promises.rm(stage, { recursive: true, force: true }) }
    }
    send({ status: health.every(e => e.available) ? 'background-check' : 'repairing', progress: 90, message: 'Completing engine setup…' })
    const result = health.every(e => e.available) ? health : await Promise.all(engineNames.map(name => receipts.inspect(name)))
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

if (!gotTheLock) app.quit()
else void app.whenReady().then(async () => {
  startupMark('electronReadyMs')
  await import('./main')
}).catch(error => { console.error('[Startup]', error); app.exit(1) })
