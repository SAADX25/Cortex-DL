import fs, { mkdir, stat, rename, unlink, readdir, open } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { type LibraryArtworkInfo, type LibraryMediaItem } from '../../../Shared/mediaLibrary'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { engineExecutionFailed } from '../engines/engineManager'
import { killProcessTree } from '../utils'

const MAX_IMAGE = 1024 * 1024

const jpeg = (bytes: Buffer) => bytes.length > 16 && bytes.length <= MAX_IMAGE && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217

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
      child.once('error', () => {  })
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

const MAX_BYTES = 8 * 1024 * 1024

const MAX_AGE = 7 * 86400000

const MAX_CACHE = 128 * 1024 * 1024

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }

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

export type PreviewExtractionOptions = {
  isClosed?: () => boolean
  track?: (stop: () => void) => () => void
}

const PREVIEW_CODECS = [
  'b[ext=mp4][vcodec^=avc1][acodec!=none]',
  'b[ext=mp4][vcodec^=avc3][acodec!=none]',
  'b[ext=mp4][vcodec^=h264][acodec!=none]',
  'b[ext=webm][vcodec^=vp09][acodec!=none]',
  'b[ext=webm][vcodec^=vp9][acodec!=none]',
  'b[ext=webm][vcodec^=vp08][acodec!=none]',
  'b[ext=webm][vcodec^=vp8][acodec!=none]',
]

export const PREVIEW_FORMAT = ['https', 'http']
  .flatMap(protocol => PREVIEW_CODECS.map(format => `${format}[protocol=${protocol}]`))
  .join('/')

export type PreviewStreams = { videoUrl: string; audioUrl?: string }

export const TRIM_PREVIEW_FORMAT = `${PREVIEW_FORMAT}/bv[ext=mp4][vcodec^=avc1][protocol=https][height<=1080]+ba[acodec^=mp4a][protocol=https]/bv[ext=webm][vcodec^=vp9][protocol=https][height<=1080]+ba[acodec=opus][protocol=https]`

function progressiveUrl(info: Record<string, unknown>): string {
  if (!['http', 'https'].includes(String(info.protocol))) throw new Error('Preview requires a progressive HTTP stream')
  const url = new URL(String(info.url))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid preview stream URL')
  const expires = Number(url.searchParams.get('expire') || url.searchParams.get('expires'))
  if (expires > 0 && expires * 1000 <= Date.now()) throw new Error('Expired preview stream URL')
  return url.href
}

export function playablePreviewStreams(info: Record<string, unknown>): PreviewStreams {
  if (!Array.isArray(info.requested_formats)) return { videoUrl: playablePreviewUrl(info) }
  const formats = info.requested_formats as Record<string, unknown>[]
  const video = formats.find(format => format.vcodec && format.vcodec !== 'none')
  const audio = formats.find(format => format.vcodec === 'none' && format.acodec && format.acodec !== 'none')
  if (formats.length !== 2 || !video || !audio) throw new Error('Preview requires exactly one video and one audio resource')

  const videoUrl = playablePreviewUrl({ ...video, acodec: audio.acodec })
  return { videoUrl, audioUrl: progressiveUrl(audio) }
}

export function playablePreviewUrl(info: Record<string, unknown>): string {
  if (info.requested_formats || info.requested_downloads && Array.isArray(info.requested_downloads) && info.requested_downloads.length > 1) {
    throw new Error('Unsupported preview: separate video/audio resources')
  }
  const compatible = info.ext === 'mp4' && /^(avc1|avc3|h264)/i.test(String(info.vcodec))
    || info.ext === 'webm' && /^(vp09|vp9|vp08|vp8)/i.test(String(info.vcodec))
  if (!compatible || !['http', 'https'].includes(String(info.protocol))) {
    throw new Error(`Unsupported preview codec/container: ${info.vcodec}/${info.ext}, protocol=${info.protocol}`)
  }
  if (!info.acodec || info.acodec === 'none') {
    throw new Error('Unsupported preview: selected video stream has no audio track')
  }
  if (!/^(mp4a|aac|opus|vorbis)/i.test(String(info.acodec))) {
    throw new Error(`Unsupported preview audio codec: ${info.acodec}`)
  }
  return progressiveUrl(info)
}

export function extractPreview(binary: string, args: string[], options: PreviewExtractionOptions = {}): Promise<string> {
  return runPreviewExtraction(binary, args, playablePreviewUrl, options)
}

export function extractPreviewStreams(binary: string, args: string[], options: PreviewExtractionOptions = {}): Promise<PreviewStreams> {
  return runPreviewExtraction(binary, args, playablePreviewStreams, options)
}

function runPreviewExtraction<T>(binary: string, args: string[], parse: (info: Record<string, unknown>) => T, options: PreviewExtractionOptions): Promise<T> {
  if (options.isClosed?.()) return Promise.reject(new Error('Preview extraction cancelled'))
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, detached: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    child.on('error', error => engineExecutionFailed('yt-dlp', error))
    let stdout = '', stderr = '', failure = ''
    let untrack = () => {}
    let teardown: Promise<void> | undefined
    const stop = (reason: string) => {
      failure ||= reason
      teardown ??= killProcessTree(child)
    }
    const timer = setTimeout(() => stop('yt-dlp preview extraction timed out after 30 seconds'), 30_000)
    untrack = options.track?.(() => stop('Preview extraction cancelled')) ?? untrack
    child.stdout.on('data', data => { stdout += data.toString() })
    child.stderr.on('data', data => { stderr += data.toString() })
    child.once('error', error => { failure ||= `Failed to spawn yt-dlp: ${error.message}` })
    child.once('close', async code => {
      clearTimeout(timer)
      await teardown
      untrack()
      if (failure || code !== 0) { reject(new Error(failure || stderr.trim() || `yt-dlp exited with code ${code}`)); return }
      try { resolve(parse(JSON.parse(stdout))) }
      catch (error) { reject(error) }
    })
  })
}
