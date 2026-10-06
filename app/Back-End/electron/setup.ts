import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import { getBaselineDirectory, getBinDirectory, getBinaryPath } from './paths'
import { verifyEngine, promoteEngine, downloadEngine, extractEngineZip, type EngineSpec, type EngineHealth } from './engineIntegrity'
import lock from '../../engines.lock.json'
export interface SetupState {
  status: 'checking' | 'ready' | 'repairing' | 'degraded' | 'fatal'
  progress: number
  message: string
}
export let setupState: SetupState = { status: 'checking', progress: 0, message: 'Checking engines…' }
const specs: EngineSpec[] = lock.packages.flatMap(pkg => pkg.engines)
export async function engineHealth(): Promise<EngineHealth[]> {
  let bundled: EngineSpec[] = []
  try { bundled = JSON.parse(await fs.promises.readFile(path.join(getBaselineDirectory(), 'manifest.json'), 'utf8')).engines } catch { /* report unavailable below */ }
  return Promise.all(specs.map(async spec => {
    const file = getBinaryPath(spec.name)
    if (path.dirname(file) === getBaselineDirectory()) {
      const entry = bundled.find(e => e.name === spec.name)
      if (!entry?.sha256) return { name: spec.name, available: false, version: '', message: `${spec.name} verified baseline is missing` }
      return verifyEngine(file, entry)
    }
    let receipt: { sha256?: string } = {}
    try { receipt = JSON.parse(await fs.promises.readFile(`${file}.integrity.json`, 'utf8')) } catch { /* legacy engine: measure execution */ }
    return verifyEngine(file, { ...spec, version: undefined, sha256: receipt.sha256 })
  }))
}
let pending: Promise<void> | null = null
export function runSetup(win: BrowserWindow, allowNetwork = false): Promise<void> {
  if (pending) return pending
  pending = setup(win, allowNetwork).finally(() => { pending = null })
  return pending
}
async function setup(win: BrowserWindow, allowNetwork: boolean): Promise<void> {
  const send = (state: SetupState) => {
    setupState = state
    if (!win.isDestroyed()) win.webContents.send('cortexdl:setup-progress', state)
  }
  let component = 'filesystem'
  try {
    send({ status: 'checking', progress: 0, message: 'Verifying engines…' })
    const bin = getBinDirectory()
    await fs.promises.mkdir(bin, { recursive: true })
    for (const spec of specs) {
      const file = path.join(bin, spec.filename)
      if (!fs.existsSync(file) && fs.existsSync(`${file}.previous`)) await fs.promises.rename(`${file}.previous`, file)
    }
    const health = await engineHealth()
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]
      if (health[i].available) continue
      component = spec.name
      send({ status: 'repairing', progress: Math.round(i / specs.length * 100), message: `${health[i].message}. Restoring bundled ${spec.name}…` })
      const baseline = getBaselineDirectory()
      let bundled: EngineSpec | undefined
      try { bundled = JSON.parse(await fs.promises.readFile(path.join(baseline, 'manifest.json'), 'utf8')).engines.find((engine: EngineSpec) => engine.name === spec.name) } catch { /* repair can retrieve pinned package */ }
      const candidate = path.join(bin, `${spec.filename}.tmp`)
      const check = bundled?.sha256 ? await verifyEngine(path.join(baseline, spec.filename), bundled) : null
      if (check?.available && bundled) await fs.promises.copyFile(path.join(baseline, spec.filename), candidate)
      else {
        if (!allowNetwork) throw new Error('Verified bundled engine is unavailable; explicit repair required')
        const pkg = lock.packages.find(pkg => pkg.engines.some(engine => engine.name === spec.name))!
        const stage = await fs.promises.mkdtemp(path.join(bin, 'repair-'))
        try {
          const archive = path.join(stage, 'package.download')
          await downloadEngine(pkg.url, archive, pkg.sha256)
          if (pkg.url.endsWith('.zip')) await extractEngineZip(archive, stage, pkg.engines.map(e => e.filename))
          else await fs.promises.copyFile(archive, path.join(stage, spec.filename))
          await fs.promises.copyFile(path.join(stage, spec.filename), candidate)
          const { sha256 } = await import('./engineIntegrity')
          bundled = { ...spec, sha256: await sha256(candidate) }
        } finally { await fs.promises.rm(stage, { recursive: true, force: true }) }
      }
      try {
        await promoteEngine(candidate, path.join(bin, spec.filename), bundled!)
        await fs.promises.writeFile(path.join(bin, `${spec.filename}.integrity.json`), JSON.stringify({ sha256: bundled!.sha256 }))
      }
      finally { await fs.promises.rm(candidate, { force: true }) }
      log.info('[Engines] Repaired', spec.name)
    }
    const result = health.every(e => e.available) ? health : await engineHealth()
    if (result.some(engine => !engine.available)) throw new Error('Post-repair verification failed')
    log.info('[Engines] Healthy', result)
    send({ status: 'ready', progress: 100, message: 'Ready' })
  } catch (error) {
    log.error('[Setup]', component, error)
    const code = (error as NodeJS.ErrnoException).code || (error as { cause?: NodeJS.ErrnoException }).cause?.code
    const http = /HTTP (\d{3})/.exec(String(error))
    const reason = http ? `Network download failed (HTTP ${http[1]}). Retry later.` : code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' ? 'Network unavailable. Check your connection and retry.' : code === 'ENOSPC' ? 'Disk is full.' : code === 'EACCES' || code === 'EPERM' ? 'Folder is not writable or security software blocked access.' : 'The bundled engine is missing, damaged, or cannot launch.'
    send({ status: 'degraded', progress: 0, message: `${component}: ${reason} Retry repair or open diagnostics.` })
    throw error
  }
}
