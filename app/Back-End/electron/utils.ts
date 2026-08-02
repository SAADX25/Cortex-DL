import log from 'electron-log'
import { Notification, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { DownloadTask, TaskRuntime } from './types'
import { UPDATE_CHANNEL } from './types'

export function sanitizeFilename(name: string): string {
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
  if (!win || win.isDestroyed()) return
  win.webContents.send(UPDATE_CHANNEL, task)
}

/**
 * IPC throttle interval. 100ms ≈ 10 updates/sec — smooth enough for
 * progress bars without flooding the renderer's event loop.
 */
const IPC_THROTTLE_MS = 100

/** Terminal statuses that must ALWAYS be sent immediately, never throttled. */
const TERMINAL_STATUSES = new Set(['completed', 'error', 'canceled', 'paused'])

/** Pending trailing update per task, keyed by task id. */
const pendingTrailing = new Map<string, {
  timer: ReturnType<typeof setTimeout>
  task: DownloadTask
  win: BrowserWindow
}>()

/**
 * Throttled IPC sender with leading + trailing edge guarantee.
 *
 * - **Leading edge**: the first call in each `IPC_THROTTLE_MS` window fires immediately.
 * - **Trailing edge**: if further calls arrive within the window, the *last* one
 *   is scheduled to fire when the window expires. This ensures the final progress
 *   tick (e.g. 99.8% → 100%) is never silently dropped.
 * - **Terminal states** (completed/error/canceled/paused) always bypass the throttle
 *   entirely and fire immediately, flushing any pending trailing update first.
 *
 * Returns `true` if an IPC message was actually sent (for DB write decisions).
 */
export function throttledSendUpdate(
  win: BrowserWindow | null,
  task: DownloadTask,
  runtime: TaskRuntime,
): boolean {
  if (!win || win.isDestroyed()) return false

  // Terminal states: flush any pending trailing, then send immediately.
  if (TERMINAL_STATUSES.has(task.status)) {
    clearPendingTrailing(task.id)
    runtime.lastIpcAtMs = Date.now()
    win.webContents.send(UPDATE_CHANNEL, task)
    return true
  }

  const now = Date.now()
  const elapsed = now - runtime.lastIpcAtMs

  // Leading edge: enough time has passed, send immediately.
  if (elapsed >= IPC_THROTTLE_MS) {
    clearPendingTrailing(task.id)
    runtime.lastIpcAtMs = now
    win.webContents.send(UPDATE_CHANNEL, task)
    return true
  }

  // Within throttle window: schedule a trailing update.
  // Each new call replaces the previous pending update with fresh data.
  schedulePendingTrailing(task, win, runtime)
  return false
}

/**
 * Flush any pending trailing IPC update for a specific task.
 * Call this before setting terminal status to ensure the last
 * progress snapshot reaches the renderer.
 */
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
  // Cancel any existing trailing timer for this task.
  const existing = pendingTrailing.get(task.id)
  if (existing) clearTimeout(existing.timer)

  // Snapshot the task data so the trailing fire has the latest values.
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

function clearPendingTrailing(taskId: string): void {
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

/**
 * Forcefully kills a child process and its entire process tree.
 *
 * On Windows: uses `taskkill /F /T /PID` to terminate the tree,
 * with a 5-second safety timeout so a hung taskkill never blocks the app.
 * Falls back to `child.kill('SIGKILL')` if taskkill fails.
 *
 * On POSIX: sends SIGKILL to the process group via `process.kill(-pid)`.
 *
 * All errors are swallowed — the caller will never throw.
 */
export async function killProcessTree(child: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!child) return

  const pid = child.pid
  if (!pid) {
    // Process was spawned but no PID was assigned (e.g. spawn error).
    // Last-resort: attempt a direct kill on the child handle itself.
    try { child.kill('SIGKILL') } catch { /* already dead */ }
    return
  }

  // Probe whether the process is still alive before doing anything.
  // process.kill(pid, 0) throws if the PID doesn't exist.
  try {
    process.kill(pid, 0)
  } catch {
    log.info(`[killProcessTree] PID ${pid} already exited — nothing to kill`)
    return
  }

  if (process.platform === 'win32') {
    try {
      const exitCode = await spawnTaskkill(pid)
      log.info(`[killProcessTree] taskkill PID ${pid} exited with code ${exitCode}`)
    } catch (err) {
      // taskkill itself failed or timed out — fall back to direct kill.
      log.warn(`[killProcessTree] taskkill failed for PID ${pid}, falling back to SIGKILL:`, err)
      try { child.kill('SIGKILL') } catch { /* swallow */ }
    }
  } else {
    // POSIX: kill the entire process group (negative PID).
    try {
      process.kill(-pid, 'SIGKILL')
      log.info(`[killProcessTree] Sent SIGKILL to process group ${pid}`)
    } catch {
      try { child.kill('SIGKILL') } catch { /* swallow */ }
    }
  }
}

/** Maximum time to wait for `taskkill` before giving up (ms). */
const TASKKILL_TIMEOUT_MS = 5_000

/**
 * Spawns `taskkill /F /T /PID <pid>` and returns a promise that resolves
 * with the exit code, or rejects on spawn error / timeout.
 */
function spawnTaskkill(pid: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
      windowsHide: true,
      detached: false,
      stdio: 'ignore',
    })

    const timer = setTimeout(() => {
      try { killer.kill() } catch { /* swallow */ }
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
