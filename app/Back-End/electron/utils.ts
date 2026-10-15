import log from 'electron-log'
import { Notification, BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { type DownloadTask, type TaskRuntime, UPDATE_CHANNEL } from './types'
import { updateTaskProgress } from '../../Shared/progressModel'

export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  let sanitized = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '').trim()
  sanitized = sanitized.replace(/[\s_]+/g, '_')
  sanitized = sanitized.replace(/-+/g, '-')
  sanitized = sanitized.replace(/^[-_.]+|[-_.]+$|\.+$/g, '')
  return sanitized.length > 0 ? sanitized : 'download'
}

export function withExtension(filename: string, extensionWithoutDot: string): string {
  const ext = extensionWithoutDot.startsWith('.') ? extensionWithoutDot.slice(1) : extensionWithoutDot
  const base = filename.replace(/\.[^.]+$/i, '')
  return `${base}.${ext}`
}

export function parseFilenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).at(-1)
    if (!last) return null
    return sanitizeFilename(decodeURIComponent(last))
  } catch {
    return null
  }
}

export function getDefaultFilename(inputUrl: string): string {
  return parseFilenameFromUrl(inputUrl) || 'download'
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function isM3u8Url(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url)
}

export function nowMs(): number {
  return Date.now()
}

export function parseTimeToSeconds(ts: string): number {
  const parts = ts.split(':')
  let secs = 0
  for (let i = 0; i < parts.length; i++) {
    secs = secs * 60 + parseFloat(parts[i])
  }
  return isNaN(secs) ? 0 : secs
}

export function computeSpeed(task: DownloadTask, runtime: TaskRuntime): void {
  const now = nowMs()
  if (runtime.lastSpeedSampleAtMs == null || runtime.lastSpeedSampleBytes == null) {
    runtime.lastSpeedSampleAtMs = now
    runtime.lastSpeedSampleBytes = task.downloadedBytes
    task.speedBytesPerSec = null
    return
  }
  const dtMs = now - runtime.lastSpeedSampleAtMs
  if (dtMs < 800) return
  const db = task.downloadedBytes - runtime.lastSpeedSampleBytes
  task.speedBytesPerSec = Math.max(0, Math.round((db * 1000) / dtMs))
  runtime.lastSpeedSampleAtMs = now
  runtime.lastSpeedSampleBytes = task.downloadedBytes
}

export async function ensureDirectoryExists(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
}

export async function getFileSizeIfExists(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath)
    return stat.size
  } catch {
    return 0
  }
}

export function parseTotalFromContentRange(value: string | null): number | null {
  if (!value) return null
  const match = /^bytes\s+\d+-\d+\/(\d+|\*)$/i.exec(value.trim())
  if (!match || match[1] === '*') return null
  const total = Number(match[1])
  return Number.isFinite(total) && total > 0 ? total : null
}

export function sendUpdate(win: BrowserWindow | null, task: DownloadTask): void {
  updateTaskProgress(task)
  if (!win || win.isDestroyed()) return
  win.webContents.send(UPDATE_CHANNEL, task)
}

const IPC_THROTTLE_MS = 100

const TERMINAL_STATUSES = new Set(['completed', 'error', 'canceled', 'paused'])

const pendingTrailing = new Map<string, {
  timer: ReturnType<typeof setTimeout>
  task: DownloadTask
  win: BrowserWindow
}>()

export function throttledSendUpdate(
  win: BrowserWindow | null,
  task: DownloadTask,
  runtime: TaskRuntime,
): boolean {
  updateTaskProgress(task)
  if (!win || win.isDestroyed()) return false

  if (TERMINAL_STATUSES.has(task.status)) {
    clearPendingTrailing(task.id)
    runtime.lastIpcAtMs = Date.now()
    win.webContents.send(UPDATE_CHANNEL, task)
    return true
  }

  const now = Date.now()
  const elapsed = now - runtime.lastIpcAtMs

  if (elapsed >= IPC_THROTTLE_MS) {
    clearPendingTrailing(task.id)
    runtime.lastIpcAtMs = now
    win.webContents.send(UPDATE_CHANNEL, task)
    return true
  }

  schedulePendingTrailing(task, win, runtime)
  return false
}

export function flushPendingIpc(taskId: string): void {
  const pending = pendingTrailing.get(taskId)
  if (!pending) return

  clearTimeout(pending.timer)
  pendingTrailing.delete(taskId)

  if (!pending.win.isDestroyed()) {
    pending.win.webContents.send(UPDATE_CHANNEL, pending.task)
  }
}

function schedulePendingTrailing(task: DownloadTask, win: BrowserWindow, runtime: TaskRuntime): void {
  const existing = pendingTrailing.get(task.id)
  if (existing) clearTimeout(existing.timer)

  const snapshot = { ...task }
  const remainingMs = Math.max(1, IPC_THROTTLE_MS - (Date.now() - runtime.lastIpcAtMs))

  const timer = setTimeout(() => {
    pendingTrailing.delete(task.id)
    if (win.isDestroyed()) return
    runtime.lastIpcAtMs = Date.now()
    win.webContents.send(UPDATE_CHANNEL, snapshot)
  }, remainingMs)

  pendingTrailing.set(task.id, { timer, task: snapshot, win })
}

export function clearPendingTrailing(taskId: string): void {
  const pending = pendingTrailing.get(taskId)
  if (pending) {
    clearTimeout(pending.timer)
    pendingTrailing.delete(taskId)
  }
}

export function sendNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
}

// Windows needs taskkill /T; POSIX children run in their own process group.
const pendingKills = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>()

export function killProcessTree(child: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!child) return Promise.resolve()
  const existing = pendingKills.get(child)
  if (existing) return existing
  const pending = terminateProcessTree(child)
  pendingKills.set(child, pending)
  void pending.finally(() => pendingKills.delete(child))
  return pending
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!child) return

  const pid = child.pid
  if (!pid) {
    child.kill('SIGKILL')
    return
  }

  if (process.platform === 'win32' && (typeof child.exitCode === 'number' || child.signalCode)) return

  if (process.platform === 'win32') {
    try {
      const exitCode = await spawnTaskkill(pid)
      log.info(`[killProcessTree] taskkill PID ${pid} exited with code ${exitCode}`)
      if (exitCode !== 0) {
        child.kill('SIGKILL')
      }
    } catch (err) {
      // taskkill itself failed or timed out — fall back to direct kill.
      log.warn(`[killProcessTree] taskkill failed for PID ${pid}, falling back to SIGKILL:`, err)
      child.kill('SIGKILL')
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
      log.info(`[killProcessTree] Sent SIGKILL to process group ${pid}`)
    } catch {
      child.kill('SIGKILL')
    }
  }
}


const TASKKILL_TIMEOUT_MS = 5_000


function spawnTaskkill(pid: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
      windowsHide: true,
      detached: false,
      stdio: 'ignore',
    })

    const timer = setTimeout(() => {
      killer.kill()
      reject(new Error(`taskkill timed out after ${TASKKILL_TIMEOUT_MS}ms for PID ${pid}`))
    }, TASKKILL_TIMEOUT_MS)

    killer.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    killer.on('close', (code) => {
      clearTimeout(timer)
      resolve(code ?? 1)
    })
  })
}
