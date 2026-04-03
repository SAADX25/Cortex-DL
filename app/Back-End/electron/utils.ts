/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Utils — Shared utility functions used across all engine modules.
 *
 *  Pure functions + thin Electron wrappers. No business logic.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Notification, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { DownloadTask, TaskRuntime } from './types'
import { UPDATE_CHANNEL } from './types'
// ── Filename Handling ────────────────────────────────────────────────────────

/**
 * Sanitizes a filename using a STRICT WHITELIST approach.
 * Only allows: English letters, Arabic letters, numbers, spaces, dashes, underscores.
 * Everything else is stripped to prevent CLI encoding issues on Windows.
 */
export function sanitizeFilename(name: string): string {
  let sanitized = name.replace(/[^\w\s\u0600-\u06FF-]/g, '')
  sanitized = sanitized.replace(/[\s_]+/g, '_')
  sanitized = sanitized.replace(/-+/g, '-')
  sanitized = sanitized.replace(/^[-_]+|[-_]+$/g, '')
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

// ── URL Helpers ──────────────────────────────────────────────────────────────

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

// ── Time & Measurement ───────────────────────────────────────────────────────

export function nowMs(): number {
  return Date.now()
}

/** Parse HH:MM:SS.ss or MM:SS.ss or SS.ss timestamp to seconds */
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

// ── File System ──────────────────────────────────────────────────────────────

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

// ── HTTP Helpers ─────────────────────────────────────────────────────────────

export function parseTotalFromContentRange(value: string | null): number | null {
  if (!value) return null
  const match = /^bytes\s+\d+-\d+\/(\d+|\*)$/i.exec(value.trim())
  if (!match || match[1] === '*') return null
  const total = Number(match[1])
  return Number.isFinite(total) && total > 0 ? total : null
}

// ── IPC & Notifications ─────────────────────────────────────────────────────

/** Raw IPC send — no throttle.  Prefer throttledSendUpdate() inside engines. */
export function sendUpdate(win: BrowserWindow | null, task: DownloadTask): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(UPDATE_CHANNEL, task)
}

/**
 * Throttled IPC send.  Drops intermediate ticks so the renderer receives
 * at most ~5 updates/sec/task (1000 / IPC_THROTTLE_MS).  State-change
 * updates (status !== 'downloading') are always sent immediately.
 */
const IPC_THROTTLE_MS = 200

export function throttledSendUpdate(
  win: BrowserWindow | null,
  task: DownloadTask,
  runtime: TaskRuntime,
): boolean {
  if (!win || win.isDestroyed()) return false
  const now = Date.now()
  // Always send lifecycle / state-change updates immediately
  const isProgress = task.status === 'downloading' || task.status === 'merging' || task.status === 'converting'
  if (!isProgress || now - runtime.lastIpcAtMs >= IPC_THROTTLE_MS) {
    runtime.lastIpcAtMs = now
    win.webContents.send(UPDATE_CHANNEL, task)
    return true
  }
  return false
}

export function sendNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
}

// ── Process Management ───────────────────────────────────────────────────────

/**
 * Kills a child process AND its entire descendant tree.
 * On Windows uses `taskkill /F /T` so yt-dlp-spawned ffmpeg/ffprobe
 * sub-processes are also terminated immediately.
 */
export function killProcessTree(child: ChildProcessWithoutNullStreams | null): void {
  if (!child) return
  const pid = child.pid
  if (!pid) {
    try { child.kill('SIGKILL') } catch { /* already dead */ }
    return
  }
  
  // Check if process is still running to avoid "Process not found" spam
  try {
    process.kill(pid, 0)
  } catch {
    return // Process is already dead
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
      windowsHide: true,
      detached: false,
      stdio: 'ignore',
    })
    killer.on('error', () => {
      try { child.kill('SIGKILL') } catch { /* already dead */ }
    })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try { child.kill('SIGKILL') } catch { /* already dead */ }
    }
  }
}
