import { app } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'

export const isDev = !app.isPackaged

export function getBinaryPath(name: string): string {
  const binaryName = process.platform === 'win32' ? `${name}.exe` : name
  if (isDev) {
    const root = process.env.APP_ROOT || process.cwd()
    const binPath = path.join(root, 'bin', binaryName)
    if (existsSync(binPath)) return binPath
    return path.join(process.cwd(), 'bin', binaryName)
  }
  return path.join(process.resourcesPath, 'bin', binaryName)
}

export function getBinDirectory(): string {
  if (isDev) {
    const root = process.env.APP_ROOT || process.cwd()
    const binDir = path.join(root, 'bin')
    if (existsSync(binDir)) return binDir
    const cwdBin = path.join(process.cwd(), 'bin')
    if (existsSync(cwdBin)) return cwdBin
    return path.join(root, 'bin')
  }
  return path.join(process.resourcesPath, 'bin')
}
