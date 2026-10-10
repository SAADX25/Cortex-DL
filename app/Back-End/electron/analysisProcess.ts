import { engineExecutionFailed } from './engineReadiness'
import { spawn } from 'node:child_process'
import { killProcessTree } from './utils'
import { StringDecoder } from 'node:string_decoder'
import { analysisTiming } from './analysisTiming'

/** Analysis-only child; resolve/reject after close so a concurrency slot owns all teardown. */
export function extractAnalysis(binary: string, args: string[], signal: AbortSignal,
  maxBytes = 32 * 1024 * 1024, timeoutMs = 90000): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const child = spawn(binary, args, { windowsHide: true, detached: process.platform !== 'win32',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    child.on('error', error => engineExecutionFailed('yt-dlp', error))
    child.once('spawn', () => analysisTiming('ytdlpStartupMs', start))
    let output = ''
    const decoder = new StringDecoder('utf8')
    let bytes = 0
    let stderr = ''
    let failure: Error | undefined
    let teardown: Promise<void> | undefined
    const stop = () => { teardown ??= killProcessTree(child) }
    const timer = setTimeout(() => { failure = new Error('Analysis timed out'); stop() }, timeoutMs)
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    child.stdout.on('data', (data: Buffer) => {
      bytes += data.length
      if (bytes > maxBytes) { failure ??= new Error('Analysis output exceeds size limit'); stop(); return }
      if (!failure && !signal.aborted) output += decoder.write(data)
    })
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-8192) })
    child.on('error', error => { failure = error })
    child.on('close', async code => {
      analysisTiming('ytdlpExtractionMs', start)
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      await teardown
      child.stdout.removeAllListeners(); child.stderr.removeAllListeners()
      if (signal.aborted) reject(signal.reason)
      else if (failure) reject(failure)
      else if (code !== 0) reject(new Error(stderr || `Analysis exited with code ${code}`))
      else resolve(output + decoder.end())
    })
  })
}
