import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, stat, rename, unlink, readdir, open } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_AGE = 7 * 86400000
const MAX_CACHE = 128 * 1024 * 1024
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }

/** Small header/trailer checks catch mislabeled bodies and incomplete cache files without decoding. */
async function validImage(file: string, extension: string, size: number): Promise<boolean> {
  if (size < 16) return false
  const handle = await open(file, 'r')
  try {
    const header = Buffer.alloc(Math.min(size, 64))
    const tail = Buffer.alloc(16)
    await handle.read(header, 0, header.length, 0)
    await handle.read(tail, 0, tail.length, size - tail.length)
    if (extension === 'png') return header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && header.toString('ascii', 12, 16) === 'IHDR' && tail.toString('ascii', 8, 12) === 'IEND'
    if (extension === 'jpg') return header[0] === 255 && header[1] === 216 && header[2] === 255 && tail[14] === 255 && tail[15] === 217
    if (extension === 'webp') return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP' && header.readUInt32LE(4) + 8 === size
    if (extension === 'gif') return /^GIF8[79]a/.test(header.toString('ascii', 0, 6)) && tail[15] === 59
    return header.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(header.toString('ascii', 8))
  } finally { await handle.close() }
}

export class ThumbnailCache {
  private pending = new Map<string, Promise<string>>()
  private lastCleanup = 0
  constructor(private directory: string) {}

  fetch(input: string): Promise<string> {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol)) return Promise.reject(new Error('Invalid thumbnail protocol'))
    const key = createHash('sha256').update(url.toString()).digest('hex')
    const existing = this.pending.get(key)
    if (existing) return existing
    const work = this.download(url.toString(), key).finally(() => this.pending.delete(key))
    this.pending.set(key, work)
    return work
  }

  private async cleanup(): Promise<void> {
    if (Date.now() - this.lastCleanup < 3600000) return
    this.lastCleanup = Date.now()
    const files = await readdir(this.directory)
    const entries = []
    for (const name of files) {
      if (!/^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{32})\.(?:jpg|png|webp|gif|avif)(?:\.part)?$/.test(name)) continue
      const file = path.join(this.directory, name)
      const info = await stat(file).catch(() => null)
      if (info) entries.push({ file, name, ...info })
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
    let total = 0
    for (const entry of entries) {
      total += entry.size
      if (Date.now() - entry.mtimeMs > MAX_AGE || total > MAX_CACHE ||
        (entry.name.endsWith('.part') && Date.now() - entry.mtimeMs > 3600000)) {
        if (!this.pending.has(entry.name.slice(0, 64))) await unlink(entry.file).catch(() => {})
      }
    }
  }

  private async download(url: string, key: string): Promise<string> {
    await mkdir(this.directory, { recursive: true })
    await this.cleanup()
    for (const extension of new Set(Object.values(TYPES))) {
      const candidate = path.join(this.directory, `${key}.${extension}`)
      const cached = await stat(candidate).catch(() => null)
      if (cached && cached.size > 0 && cached.size <= MAX_BYTES && Date.now() - cached.mtimeMs < MAX_AGE &&
        await validImage(candidate, extension, cached.size).catch(() => false)) return candidate
      if (cached) await unlink(candidate).catch(() => {})
    }
    let partial: string | undefined
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('Thumbnail request timed out')), 10000)
    try {
      const response = await fetch(url, { signal: controller.signal,
        headers: { Referer: 'https://www.instagram.com/', 'User-Agent': 'Mozilla/5.0' } })
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
      if (!response.ok || !type || !TYPES[type] || !response.body ||
        Number(response.headers.get('content-length')) > MAX_BYTES) {
        await response.body?.cancel()
        throw new Error('Invalid or oversized thumbnail response')
      }
      const file = path.join(this.directory, `${key}.${TYPES[type]}`)
      partial = `${file}.part`
      let size = 0
      const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        callback(size > MAX_BYTES ? new Error('Thumbnail exceeds size limit') : null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body as any), bound, createWriteStream(partial), { signal: controller.signal })
      if (!size) throw new Error('Empty thumbnail')
      if (!await validImage(partial, TYPES[type], size)) throw new Error('Corrupt thumbnail response')
      await rename(partial, file)
      return file
    } finally { clearTimeout(timer); if (partial) await unlink(partial).catch(() => {}) }
  }
}
