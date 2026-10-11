import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { canEditLibraryArtwork, libraryMediaKind, type LibraryMediaItem, type LibraryImportResult } from '../../Shared/mediaLibrary'

type SavedItem = Omit<LibraryMediaItem, 'availability'>
const validPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 32767 && !value.includes('\0') && path.isAbsolute(value)
const key = (value: string) => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value)

/** Owns library references and cover storage; explicit cover edits may update media tags. */
export class MediaLibrary {
  private entries: SavedItem[] | null = null
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string) {}

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action)
    this.queue = result.catch(() => {})
    return result
  }

  private async load(): Promise<SavedItem[]> {
    if (this.entries) return this.entries
    let raw: unknown
    try {
      if ((await fs.stat(this.file)).size > 8 * 1024 * 1024) throw new Error('MEDIA_LIBRARY_INVALID')
      raw = JSON.parse(await fs.readFile(this.file, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.entries = []
      throw new Error('MEDIA_LIBRARY_READ_FAILED')
    }
    const data = raw as { version?: unknown; items?: unknown }
    if (!data || data.version !== 1 || !Array.isArray(data.items) || data.items.length > 10000) throw new Error('MEDIA_LIBRARY_INVALID')
    const ids = new Set<string>(), paths = new Set<string>()
    const entries: SavedItem[] = []
    for (const value of data.items) {
      const item = value as SavedItem
      if (!item || typeof item.id !== 'string' || !/^[\w-]{1,128}$/.test(item.id) || !validPath(item.filePath)
        || libraryMediaKind(item.filePath) !== item.kind || typeof item.name !== 'string' || item.name.length > 32767
        || !Number.isFinite(item.size) || item.size < 0 || !Number.isFinite(item.addedAt)
        || item.lastPlayedAt !== null && !Number.isFinite(item.lastPlayedAt) || ids.has(item.id) || paths.has(key(item.filePath))) throw new Error('MEDIA_LIBRARY_INVALID')
      if (item.artwork !== undefined && (typeof item.artwork !== 'string' || !/^[a-f0-9]{64}$/.test(item.artwork))) throw new Error('MEDIA_LIBRARY_INVALID')
      if (item.artworkEmbedded !== undefined && (item.artworkEmbedded !== true || !item.artwork)) throw new Error('MEDIA_LIBRARY_INVALID')
      ids.add(item.id); paths.add(key(item.filePath)); entries.push(item)
    }
    return this.entries = entries
  }

  private async save(entries: SavedItem[]): Promise<void> {
    const serialized = JSON.stringify({ version: 1, items: entries })
    if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) throw new Error('MEDIA_LIBRARY_FULL')
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx')
      try { await handle.writeFile(serialized); await handle.sync() }
      finally { await handle.close() }
      await fs.rename(temporary, this.file)
      this.entries = entries
    } finally { await fs.unlink(temporary).catch(() => {}) }
  }

  private async inspect(filePath: string): Promise<{ size: number; availability: LibraryMediaItem['availability'] }> {
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) return { size: 0, availability: 'unreadable' }
      await fs.access(filePath, constants.R_OK)
      return { size: stat.size, availability: 'available' }
    } catch (error) {
      return { size: 0, availability: ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'missing' : 'unreadable' }
    }
  }

  private async snapshot(entries: SavedItem[]): Promise<LibraryMediaItem[]> {
    const items: LibraryMediaItem[] = []
    for (let offset = 0; offset < entries.length; offset += 32) {
      items.push(...await Promise.all(entries.slice(offset, offset + 32).map(async item => {
        const status = await this.inspect(item.filePath)
        return { ...item, ...status, size: status.availability === 'available' ? status.size : item.size }
      })))
    }
    return items
  }

  list(): Promise<LibraryMediaItem[]> { return this.serial(async () => this.snapshot(await this.load())) }

  get(id: string): Promise<LibraryMediaItem | null> {
    return this.serial(async () => {
      const item = (await this.load()).find(entry => entry.id === id)
      if (!item) return null
      return { ...item, ...await this.inspect(item.filePath) }
    })
  }

  /** Grant the selected file itself, never its parent directory or siblings. */
  canServe(requestedPath: string, resolvedPath: string): Promise<boolean> {
    return this.serial(async () => {
      const item = (await this.load()).find(entry => key(entry.filePath) === key(requestedPath))
      if (!item) return false
      const actual = await fs.realpath(item.filePath).catch(() => null)
      return actual !== null && key(actual) === key(resolvedPath)
    })
  }

  private artworkFile(artwork: string): string { return path.join(path.dirname(this.file), 'library-artwork', `${artwork}.jpg`) }

  getArtwork(id: string): Promise<Buffer | null> {
    return this.serial(async () => {
      const item = (await this.load()).find(entry => entry.id === id)
      if (!item?.artwork) return null
      const file = this.artworkFile(item.artwork), stat = await fs.stat(file).catch(() => null)
      if (!stat?.isFile() || stat.size > 1024 * 1024) return null
      return fs.readFile(file).catch(() => null)
    })
  }

  private async discardArtwork(artwork: string | undefined): Promise<void> {
    if (artwork && !this.entries?.some(item => item.artwork === artwork)) await fs.unlink(this.artworkFile(artwork)).catch(() => {})
  }

  /** Store artwork and coordinate optional embedded metadata as one recoverable edit. */
  setArtwork(id: string, image: Buffer | null, editMedia?: (file: string, persist: (embedded?: boolean) => Promise<void>) => Promise<void>): Promise<LibraryMediaItem[]> {
    return this.serial(async () => {
      const entries = await this.load(), item = entries.find(entry => entry.id === id)
      if (!item) throw new Error('MEDIA_LIBRARY_NOT_FOUND')
      if (!canEditLibraryArtwork(item)) throw new Error('MEDIA_LIBRARY_ARTWORK_UNSUPPORTED')
      if (image && (image.length < 16 || image.length > 1024 * 1024 || image[0] !== 255 || image[1] !== 216 || image.at(-2) !== 255 || image.at(-1) !== 217)) throw new Error('MEDIA_LIBRARY_ARTWORK_INVALID')
      const artwork = image ? createHash('sha256').update(image).digest('hex') : undefined
      if (image && artwork) {
        const target = this.artworkFile(artwork), temporary = `${target}.${randomUUID()}.tmp`
        await fs.mkdir(path.dirname(target), { recursive: true })
        try {
          const handle = await fs.open(temporary, 'wx')
          try { await handle.writeFile(image); await handle.sync() } finally { await handle.close() }
          await fs.rename(temporary, target)
        } finally { await fs.unlink(temporary).catch(() => {}) }
      }
      const updated = { ...item }
      if (artwork) updated.artwork = artwork
      else delete updated.artwork
      const persist = async (embedded = false) => {
        if (artwork && embedded) updated.artworkEmbedded = true
        else delete updated.artworkEmbedded
        updated.size = (await fs.stat(item.filePath)).size
        await this.save(entries.map(entry => entry.id === id ? updated : entry))
      }
      try { if (editMedia) await editMedia(item.filePath, persist); else await persist() }
      catch (error) { await this.discardArtwork(artwork); throw error }
      await this.discardArtwork(item.artwork)
      return this.snapshot(this.entries!)
    })
  }

  add(filePaths: string[]): Promise<LibraryImportResult> {
    return this.serial(async () => {
      if (!Array.isArray(filePaths) || filePaths.length > 500 || !filePaths.every(validPath)) throw new Error('MEDIA_LIBRARY_INVALID_PATH')
      const entries = [...await this.load()], known = new Set(entries.map(item => key(item.filePath)))
      const result: LibraryImportResult = { items: [], added: 0, duplicates: 0, rejected: [] }
      for (const source of filePaths) {
        const filePath = path.normalize(source), kind = libraryMediaKind(filePath)
        if (!kind) { result.rejected.push({ filePath, reason: 'unsupported' }); continue }
        if (known.has(key(filePath))) { result.duplicates++; continue }
        const status = await this.inspect(filePath)
        if (status.availability !== 'available') { result.rejected.push({ filePath, reason: status.availability }); continue }
        if (entries.length >= 10000) throw new Error('MEDIA_LIBRARY_FULL')
        entries.push({ id: randomUUID(), filePath, name: path.basename(filePath), kind, size: status.size, addedAt: Date.now(), lastPlayedAt: null })
        known.add(key(filePath)); result.added++
      }
      if (result.added) await this.save(entries)
      result.items = await this.snapshot(entries)
      return result
    })
  }

  remove(id: string): Promise<LibraryMediaItem[]> {
    return this.serial(async () => {
      const entries = await this.load()
      await this.save(entries.filter(item => item.id !== id))
      await this.discardArtwork(entries.find(item => item.id === id)?.artwork)
      return this.snapshot(this.entries!)
    })
  }

  play(id: string): Promise<LibraryMediaItem> {
    return this.serial(async () => {
      const entries = await this.load(), item = entries.find(entry => entry.id === id)
      if (!item) throw new Error('MEDIA_LIBRARY_NOT_FOUND')
      const status = await this.inspect(item.filePath)
      if (status.availability !== 'available') throw new Error(status.availability === 'missing' ? 'MEDIA_LIBRARY_MISSING' : 'MEDIA_LIBRARY_UNREADABLE')
      const played = { ...item, size: status.size, lastPlayedAt: Date.now() }
      await this.save(entries.map(entry => entry.id === id ? played : entry))
      return { ...played, availability: 'available' }
    })
  }

  relocate(id: string, filePath: string): Promise<LibraryMediaItem[]> {
    return this.serial(async () => {
      if (!validPath(filePath) || !libraryMediaKind(filePath)) throw new Error('MEDIA_LIBRARY_INVALID_PATH')
      const entries = await this.load(), item = entries.find(entry => entry.id === id)
      if (!item) throw new Error('MEDIA_LIBRARY_NOT_FOUND')
      if (entries.some(entry => entry.id !== id && key(entry.filePath) === key(filePath))) throw new Error('MEDIA_LIBRARY_DUPLICATE')
      const status = await this.inspect(filePath)
      if (status.availability !== 'available') throw new Error('MEDIA_LIBRARY_MISSING')
      const updated = { ...item, filePath: path.normalize(filePath), name: path.basename(filePath), kind: libraryMediaKind(filePath)!, size: status.size }
      delete updated.artworkEmbedded
      await this.save(entries.map(entry => entry.id === id ? updated : entry))
      return this.snapshot(this.entries!)
    })
  }
}
