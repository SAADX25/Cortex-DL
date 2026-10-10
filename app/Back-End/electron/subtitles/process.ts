import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { killProcessTree } from '../utils'
import path from 'node:path'

/** Each operation owns its processes; cancellation waits for their exit. */
export class SubtitleProcesses {
  private children = new Map<ChildProcessWithoutNullStreams, Promise<void>>()
  constructor(readonly signal: AbortSignal) {}
  spawn(binary: string, args: string[], onOutput?: (output: string) => void): { child: ChildProcessWithoutNullStreams; settled: Promise<void> } {
    this.signal.throwIfAborted()
    const child = spawn(binary, args, { windowsHide: true, cwd: path.dirname(binary), detached: process.platform !== 'win32', stdio: 'pipe' })
    child.stdin.end()
    const abort = () => { void killProcessTree(child) }
    this.signal.addEventListener('abort', abort, { once: true })
    let tail = ''
    const output = (data: Buffer) => { const text = data.toString(); tail = (tail + text).slice(-6000); onOutput?.(text) }
    child.stdout.on('data', output); child.stderr.on('data', output)
    const settled = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', code => {
        this.children.delete(child); this.signal.removeEventListener('abort', abort)
        if (this.signal.aborted) reject(new DOMException('Canceled', 'AbortError'))
        else if (code !== 0) reject(new Error(`Local engine failed (${code}): ${tail.replace(/https?:\/\/\S+/g, '[URL]').slice(-1500)}`))
        else resolve()
      })
    })
    // The translation server remains alive while requests run; attach immediately.
    void settled.catch(() => {})
    this.children.set(child, settled)
    return { child, settled }
  }
  async run(binary: string, args: string[], onOutput?: (output: string) => void): Promise<void> { await this.spawn(binary, args, onOutput).settled }
  async stop(): Promise<void> {
    const owned = [...this.children]
    await Promise.all(owned.map(([child]) => killProcessTree(child)))
    await Promise.allSettled(owned.map(([, settled]) => settled))
  }
}
