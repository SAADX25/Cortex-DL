// Must evaluate before database/native imports, including in packaged smoke runs.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { initializeDiagnostics } from './diagnostics'

export const smokeDirectory = process.argv.find(arg => arg.startsWith('--smoke-dir='))?.slice('--smoke-dir='.length)
export const startupProbe = process.argv.includes('--startup-probe')
if ((process.argv.includes('--packaged-smoke') || startupProbe) && smokeDirectory) {
  if (!path.isAbsolute(smokeDirectory)) throw new Error('Smoke directory must be absolute')
  fs.mkdirSync(smokeDirectory, { recursive: true })
  app.setPath('userData', smokeDirectory)
}
if (smokeDirectory && process.argv.includes('--smoke-offline')) {
  const networkFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return Promise.reject(new Error('Offline fixture: external network disabled'))
    return networkFetch(input, init)
  }
}
const marker = path.join(app.getPath('userData'), 'startup-state.json')
export let previousStartupFailed = false
try { previousStartupFailed = JSON.parse(fs.readFileSync(marker, 'utf8')).state === 'starting' } catch { /* first run */ }
export const safeMode = process.argv.includes('--safe-mode')
if (safeMode) app.disableHardwareAcceleration()
initializeDiagnostics()
export const gotTheLock = app.requestSingleInstanceLock()
export function markStartup(state: 'starting' | 'ready' | 'clean-shutdown'): void {
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(`${marker}.tmp`, JSON.stringify({ state, timestamp: new Date().toISOString() }))
    fs.renameSync(`${marker}.tmp`, marker)
  } catch { /* diagnostics marker must never prevent download or shutdown */ }
}
if (gotTheLock) markStartup('starting')
