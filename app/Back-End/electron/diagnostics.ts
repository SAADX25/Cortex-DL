import { app, dialog, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import log from 'electron-log'

/** Redact all HTTP URLs, authorization/cookie lines and named secrets at the logging boundary. */
export function redact(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/(?:authorization|cookie|set-cookie|password|oauth|access_token|refresh_token)[^\r\n]*/gi, '[secret redacted]')
}
export function buildInfo(): { version: string; commit: string; dirty?: boolean; buildDate?: string } {
  try {
    const file = app.isPackaged ? path.join(process.resourcesPath, 'build-manifest.json') : path.join(process.env.APP_ROOT || process.cwd(), 'build-manifest.json')
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch { return { version: app.getVersion(), commit: 'development' } }
}
export function initializeDiagnostics(): void {
  log.transports.file.maxSize = 2 * 1024 * 1024
  log.hooks.push(message => ({ ...message, data: message.data.map(value => redact(value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value))) }))
  log.info('[Startup]', { ...buildInfo(), os: `${os.platform()} ${os.release()}`, electron: process.versions.electron })
  const crash = (type: string, detail: unknown) => log.error('[Crash]', { timestamp: new Date().toISOString(), ...buildInfo(), type, detail })
  process.on('uncaughtException', error => { crash('main', error.stack); app.exit(1) })
  process.on('unhandledRejection', reason => crash('main rejection', reason instanceof Error ? reason.stack : String(reason)))
  app.on('child-process-gone', (_event, details) => crash(details.type, details))
}
export function logFolder(): string { return path.dirname(log.transports.file.getFile().path) }
export async function openLogs(): Promise<void> { await shell.openPath(logFolder()) }
export async function exportDiagnostics(win: BrowserWindow, health: unknown): Promise<boolean> {
  const result = await dialog.showSaveDialog(win, { title: 'Export Diagnostics', defaultPath: `Cortex-DL-${app.getVersion()}-diagnostics.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] })
  if (result.canceled || !result.filePath) return false
  const logs: string[] = []
  for (const file of fs.readdirSync(logFolder()).filter(name => /^main(?:\.old)?\.log$/.test(name))) {
    const handle = await fs.promises.open(path.join(logFolder(), file), 'r')
    try {
      const stat = await handle.stat(); const size = Math.min(stat.size, 128 * 1024)
      const data = Buffer.alloc(size); await handle.read(data, 0, size, stat.size - size)
      logs.push(redact(data.toString('utf8')))
    } finally { await handle.close() }
  }
  await fs.promises.writeFile(result.filePath, redact(JSON.stringify({ build: buildInfo(), os: `${os.platform()} ${os.release()}`, electron: process.versions.electron, health }, null, 2)) + '\n' + logs.join('\n'), 'utf8')
  return true
}
