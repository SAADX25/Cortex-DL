import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import type { LibraryArtworkInfo, LibraryMediaItem } from '../../Shared/mediaLibrary'

const MAX_IMAGE = 1024 * 1024
const jpeg = (bytes: Buffer) => bytes.length > 16 && bytes.length <= MAX_IMAGE && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217

/** Optional artwork is generated off the UI thread, two processes at a time. */
export class LibraryThumbnails {
  private pending = new Map<string, Promise<LibraryArtworkInfo>>()
  private importing = new Set<Promise<Buffer | null>>()
  private children = new Set<ChildProcess>()
  private waiting: (() => void)[] = []
  private active = 0
  private stopped = false
  private lastCleanup = 0
  private cleanupPending: Promise<void> | undefined
  constructor(private directory: string, private ffmpeg: () => Promise<string>, private discoverCover?: (file: string) => Promise<number | null>) {}

  async prepareArtwork(file: string): Promise<Buffer> {
    const stat = await fs.stat(file).catch(() => null)
    if (!stat?.isFile() || !/\.(jpe?g|png|webp)$/i.test(file) || stat.size <= 0 || stat.size > 8 * MAX_IMAGE) throw new Error('MEDIA_LIBRARY_ARTWORK_INVALID')
    const work = this.inSlot(async () => this.extract(await this.ffmpeg(), file, undefined, '600:600'), null).finally(() => this.importing.delete(work))
    this.importing.add(work)
    const image = await work
    if (!image) throw new Error('MEDIA_LIBRARY_ARTWORK_INVALID')
    return image
  }

  async get(item: LibraryMediaItem, coverStream?: number): Promise<string | null> {
    return (await this.getInfo(item, coverStream)).thumbnail
  }

  async getInfo(item: LibraryMediaItem, coverStream?: number): Promise<LibraryArtworkInfo> {
    const empty = { thumbnail: null, embedded: false }
    if (this.stopped || item.availability !== 'available') return empty
    const source = await fs.stat(item.filePath).catch(() => null)
    if (!source?.isFile()) return empty
    const stem = path.join(path.dirname(item.filePath), path.parse(item.filePath).name)
    const candidates = ['jpg', 'jpeg', 'png', 'webp'].flatMap(extension => [
      `${stem}.${extension}`,
      ...(item.kind === 'audio' ? [path.join(path.dirname(stem), `cover.${extension}`), path.join(path.dirname(stem), `folder.${extension}`)] : []),
    ])
    let cover: { file: string; size: number; mtimeMs: number } | undefined
    for (const file of candidates) {
      const stat = await fs.stat(file).catch(() => null)
      if (stat?.isFile() && stat.size > 0 && stat.size <= 8 * MAX_IMAGE) { cover = { file, size: stat.size, mtimeMs: stat.mtimeMs }; break }
    }
    const key = createHash('sha256').update(JSON.stringify([item.filePath, item.kind, source.size, source.mtimeMs, cover, coverStream])).digest('hex')
    const existing = this.pending.get(key)
    if (existing) return existing
    const work = this.create(item, cover?.file, key, coverStream).catch(() => empty).finally(() => this.pending.delete(key))
    this.pending.set(key, work)
    return work
  }

  private async inSlot<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    if (this.stopped) return fallback
    if (this.active >= 2) await new Promise<void>(resolve => this.waiting.push(resolve))
    else this.active++
    if (this.stopped) return fallback
    try { return await work() }
    finally {
      if (!this.stopped && this.waiting.length) this.waiting.shift()!()
      else this.active--
    }
  }

  private create(item: LibraryMediaItem, cover: string | undefined, key: string, coverStream?: number): Promise<LibraryArtworkInfo> {
    const empty = { thumbnail: null, embedded: false }
    return this.inSlot(async () => {
      await fs.mkdir(this.directory, { recursive: true })
      if (!this.cleanupPending) {
        this.cleanupPending = this.cleanup().catch(() => {}).finally(() => { this.cleanupPending = undefined })
      }
      const cached = path.join(this.directory, `${key}.jpg`), absent = path.join(this.directory, `${key}.none`), infoFile = path.join(this.directory, `${key}.info`)
      const bytes = await this.readImage(cached)
      const savedInfo = await this.readInfo(infoFile)
      if (bytes && savedInfo !== null) return { thumbnail: `data:image/jpeg;base64,${bytes.toString('base64')}`, embedded: savedInfo }
      if (!bytes && savedInfo !== null && await fs.access(absent).then(() => true, () => false)) return { thumbnail: null, embedded: savedInfo }
      // Discover only on a cache miss, inside the same two-worker bound as extraction.
      // Failed discovery stays retryable, including when a legacy image is available.
      let discovered = true
      if (coverStream === undefined && this.discoverCover) {
        try { coverStream = (await this.discoverCover(item.filePath)) ?? undefined }
        catch { discovered = false }
      }
      const embedded = coverStream !== undefined
      if (this.stopped) return empty
      if (bytes) {
        if (discovered) await this.writeCache(infoFile, JSON.stringify({ embedded })).catch(() => {})
        return { thumbnail: `data:image/jpeg;base64,${bytes.toString('base64')}`, embedded }
      }
      // An unavailable engine is retryable; do not cache it as missing artwork.
      const binary = await this.ffmpeg()
      if (this.stopped) return empty
      let image: Buffer | null = null
      if (coverStream !== undefined) image = await this.extract(binary, item.filePath, undefined, '320:180', `0:${coverStream}`)
      if (!image && item.kind === 'video' && cover) image = await this.extract(binary, cover)
      if (!image) image = await this.extract(binary, item.filePath, item.kind === 'video' ? 1 : undefined)
      if (!image && item.kind === 'video') image = await this.extract(binary, item.filePath)
      if (!image && item.kind === 'audio' && cover) image = await this.extract(binary, cover)
      if (this.stopped) return empty
      const target = image ? cached : absent, temporary = path.join(this.directory, `${key}.${randomUUID()}.tmp`)
      // Publish the metadata before the image/missing marker. Neither is library data.
      if (discovered) await this.writeCache(infoFile, JSON.stringify({ embedded }))
      try {
        if (image || discovered) { await fs.writeFile(temporary, image ?? ''); await fs.rename(temporary, target) }
      }
      finally { await fs.unlink(temporary).catch(() => {}) }
      return { thumbnail: image ? `data:image/jpeg;base64,${image.toString('base64')}` : null, embedded }
    }, empty)
  }

  private async readInfo(file: string): Promise<boolean | null> {
    const stat = await fs.lstat(file).catch(() => null)
    if (!stat?.isFile() || stat.size > 64) return null
    try {
      const info = JSON.parse(await fs.readFile(file, 'utf8')) as { embedded?: unknown }
      return typeof info?.embedded === 'boolean' ? info.embedded : null
    } catch { return null }
  }

  private async writeCache(file: string, data: string): Promise<void> {
    const temporary = `${file}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, data, { flag: 'wx' }); await fs.rename(temporary, file) }
    finally { await fs.unlink(temporary).catch(() => {}) }
  }

  private async readImage(file: string): Promise<Buffer | null> {
    const info = await fs.stat(file).catch(() => null)
    if (!info?.isFile() || info.size > MAX_IMAGE) return null
    const bytes = await fs.readFile(file).catch(() => null)
    return bytes && jpeg(bytes) ? bytes : null
  }

  private extract(binary: string, file: string, seek?: number, dimensions = '320:180', stream = '0:v:0'): Promise<Buffer | null> {
    if (this.stopped) return Promise.resolve(null)
    return new Promise(resolve => {
      const child = spawn(binary, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-max_alloc', '67108864', '-threads', '1',
        ...(seek !== undefined ? ['-ss', String(seek)] : []), '-i', file, '-map', stream, '-an', '-sn',
        '-vf', `scale=${dimensions}:force_original_aspect_ratio=decrease`, '-frames:v', '1', '-threads', '1', '-q:v', '4', '-c:v', 'mjpeg', '-f', 'image2pipe', 'pipe:1'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      this.children.add(child)
      const chunks: Buffer[] = []; let size = 0
      child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_IMAGE) child.kill(); else chunks.push(chunk) })
      const timer = setTimeout(() => child.kill(), 10000)
      child.once('error', () => { /* close settles launch failures too */ })
      child.once('close', code => {
        clearTimeout(timer); this.children.delete(child)
        const bytes = Buffer.concat(chunks)
        resolve(code === 0 && size <= MAX_IMAGE && jpeg(bytes) ? bytes : null)
      })
    })
  }

  private async cleanup(): Promise<void> {
    if (Date.now() - this.lastCleanup < 1800000) return
    this.lastCleanup = Date.now()
    const files = await fs.readdir(this.directory), entries = []
    const names = files.filter(name => /^[a-f0-9]{64}\.(jpg|none|info)$/.test(name))
    for (let offset = 0; offset < names.length && !this.stopped; offset += 32) {
      const batch = await Promise.all(names.slice(offset, offset + 32).map(async name => {
        const file = path.join(this.directory, name), stat = await fs.stat(file).catch(() => null)
        return stat?.isFile() ? { file, name, size: stat.size, mtime: stat.mtimeMs } : null
      }))
      for (const entry of batch) if (entry) entries.push(entry)
    }
    entries.sort((a, b) => b.mtime - a.mtime)
    let bytes = 0
    for (const entry of entries) {
      if (this.stopped) break
      bytes += entry.size
      if ((bytes > 64 * MAX_IMAGE || Date.now() - entry.mtime > 7 * 86400000) && !this.pending.has(entry.name.slice(0, 64))) await fs.unlink(entry.file).catch(() => {})
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.waiting.splice(0).forEach(resolve => resolve())
    for (const child of this.children) child.kill()
    await Promise.allSettled([...this.pending.values(), ...this.importing])
    await this.cleanupPending
  }
}
