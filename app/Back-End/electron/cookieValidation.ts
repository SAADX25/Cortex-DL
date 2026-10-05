import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { CookieValidationResult } from './types'

/** Retains validation only, never cookie contents. Stats invalidate both valid and invalid results. */
export class CookieValidationCache {
  private entries = new Map<string, { identity: string; result: CookieValidationResult }>()
  private pending = new Map<string, Promise<CookieValidationResult>>()
  fingerprint(file: string): string {
    const resolved = path.resolve(file)
    return `${resolved}:${this.entries.get(resolved)?.identity ?? 'missing'}`
  }
  validate(input: string): Promise<CookieValidationResult> {
    const file = path.resolve(input)
    const existing = this.pending.get(file)
    if (existing) return existing
    const work = this.check(file).finally(() => this.pending.delete(file))
    this.pending.set(file, work)
    return work
  }
  private async check(file: string): Promise<CookieValidationResult> {
    const result = (code: CookieValidationResult['code'], message: string): CookieValidationResult =>
      ({ valid: code === 'valid', code, message, filePath: file })
    try {
      const info = await stat(file)
      const identity = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`
      const cached = this.entries.get(file)
      if (cached?.identity === identity) return { ...cached.result }
      let validation: CookieValidationResult
      if (!info.isFile()) validation = result('not_file', 'The selected path is not a file.')
      else if (info.size > 8 * 1024 * 1024) validation = result('read_error', 'The cookies file exceeds the size limit.')
      else {
        const contents = await readFile(file, 'utf8')
        const first = (contents.split(/\r?\n/, 1)[0] ?? '').replace(/^\uFEFF/, '').trim()
        if (!['# Netscape HTTP Cookie File', '# HTTP Cookie File'].includes(first)) {
          validation = result('invalid_header', 'The file is not a Netscape cookies.txt export.')
        } else if (!/(?:^|\.)youtube\.com/i.test(contents)) validation = result('missing_youtube', 'The cookies file does not contain YouTube cookies.')
        else validation = result('valid', 'YouTube cookies file is valid.')
      }
      this.entries.delete(file)
      this.entries.set(file, { identity, result: validation })
      if (this.entries.size > 8) this.entries.delete(this.entries.keys().next().value!)
      return { ...validation }
    } catch (error) {
      this.entries.delete(file)
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? result('missing', 'The selected cookies file does not exist.')
        : result('read_error', 'The cookies file could not be read.')
    }
  }
}
