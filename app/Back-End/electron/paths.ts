import { app } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
export const isDev = !app.isPackaged
export function getBaselineDirectory(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'engines') : path.join(process.env.APP_ROOT || process.cwd(), 'engine-baseline')
}
export function getBinDirectory(): string { return path.join(app.getPath('userData'), 'bin') }
export function getBinaryPath(name: string): string {
  const filename = process.platform === 'win32' ? `${name}.exe` : name
  const mutable = path.join(getBinDirectory(), filename)
  return existsSync(mutable) ? mutable : path.join(getBaselineDirectory(), filename)
}
