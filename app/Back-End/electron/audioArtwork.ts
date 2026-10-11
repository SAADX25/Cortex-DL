import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { canEmbedLibraryArtwork } from '../../Shared/mediaLibrary'
import { refreshArtworkFile } from './artworkRefresh'
import { refreshExternalPlayerArtwork } from './externalPlayerArtwork'
import { vlcArtworkMetadata, type VlcArtworkMetadata } from './vlcArtwork'

type Probe = { format?: { duration?: string; tags?: Record<string, string> }; streams?: { index: number; codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; width?: number; height?: number; disposition?: { attached_pic?: number } }[] }

/** Remux artwork with copied media, then replace only a verified, unchanged source. */
export class AudioArtwork {
  private children = new Set<ChildProcess>()
  private pending = new Set<Promise<unknown>>()
  private stopped = false
  private inspections = new Map<string, Promise<number | null>>()
  private inspecting = 0
  private waiting: (() => void)[] = []
  constructor(private binary: (name: 'ffmpeg' | 'ffprobe') => Promise<string>, private refresh: (file: string) => Promise<unknown> = refreshArtworkFile,
    private refreshPlayer: (file: string, metadata: VlcArtworkMetadata) => Promise<unknown> = refreshExternalPlayerArtwork) {}

  private run(binary: string, args: string[]): Promise<string> {
    if (this.stopped) return Promise.reject(new Error('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED'))
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      this.children.add(child)
      let output = '', bytes = 0
      child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) child.kill(); else output += chunk.toString() })
      const timer = setTimeout(() => child.kill(), 60000)
      child.once('error', () => { /* close settles failed launches */ })
      child.once('close', code => {
        clearTimeout(timer); this.children.delete(child)
        if (code === 0 && bytes <= 1024 * 1024 && !this.stopped) resolve(output)
        else reject(new Error('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED'))
      })
    })
  }

  write(file: string, image: Buffer | null, persist: () => Promise<void>, refreshPlayer = false): Promise<void> {
    const work = this.replace(file, image, persist, refreshPlayer).finally(() => this.pending.delete(work))
    this.pending.add(work)
    return work
  }

  /** Lazy, bounded inspection of visible library items; source files are read only. */
  async coverStream(file: string): Promise<number | null> {
    if (this.stopped) return null
    const stat = await fs.stat(file).catch(() => null)
    if (!stat?.isFile()) return null
    const key = JSON.stringify([file, stat.size, stat.mtimeMs])
    const cached = this.inspections.get(key)
    if (cached) return cached
    const work = (async () => {
      if (this.inspecting >= 2) await new Promise<void>(resolve => this.waiting.push(resolve))
      else this.inspecting++
      if (this.stopped) return null
      try {
        const probe = JSON.parse(await this.run(await this.binary('ffprobe'), ['-v', 'error', '-show_entries', 'stream=index:stream_disposition=attached_pic', '-of', 'json', file])) as Probe
        return probe.streams?.find(stream => stream.disposition?.attached_pic)?.index ?? null
      } finally {
        if (!this.stopped && this.waiting.length) this.waiting.shift()!()
        else this.inspecting--
      }
    })().catch(error => { this.inspections.delete(key); throw error }).finally(() => this.pending.delete(work))
    this.inspections.set(key, work)
    this.pending.add(work)
    if (this.inspections.size > 128) this.inspections.delete(this.inspections.keys().next().value!)
    return work
  }

  private async replace(file: string, image: Buffer | null, persist: () => Promise<void>, refreshPlayer: boolean): Promise<void> {
    if (this.stopped) throw new Error('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED')
    if (!canEmbedLibraryArtwork(file)) throw new Error('MEDIA_LIBRARY_ARTWORK_UNSUPPORTED')
    const source = await fs.realpath(file), before = await fs.stat(source)
    if (!before.isFile() || before.size <= 0 || !(before.mode & 0o222)) throw new Error('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED')
    const extension = path.extname(file).toLowerCase(), prefix = path.join(path.dirname(source), `.cortex-cover-${randomUUID()}`)
    const candidate = prefix + extension, cover = prefix + '.jpg', backup = prefix + '.backup'
    let replaced = false, preserveBackup = false
    let artworkMetadata: VlcArtworkMetadata = {}
    try {
      await fs.access(source, constants.W_OK)
      const ffmpeg = await this.binary('ffmpeg')
      if (this.stopped) throw new Error('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED')
      const ffprobe = await this.binary('ffprobe')
      const probe = async (target: string): Promise<Probe> => JSON.parse(await this.run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:format_tags=title,artist,album:stream=index,codec_type,codec_name,sample_rate,channels,width,height:stream_disposition=attached_pic', '-of', 'json', target]))
      const original = await probe(source)
      artworkMetadata = vlcArtworkMetadata(original.format?.tags, original.streams?.filter(stream => stream.disposition?.attached_pic).length ?? 0)
      const media = original.streams?.filter(stream => !stream.disposition?.attached_pic) ?? []
      const videoCount = media.filter(stream => stream.codec_type === 'video').length
      if (extension !== '.mp4' ? media.length !== 1 || media[0].codec_type !== 'audio' : !media.some(stream => ['audio', 'video'].includes(stream.codec_type ?? ''))) throw new Error('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED')
      if (image) await fs.writeFile(cover, image, { flag: 'wx' })
      await this.run(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', source,
        ...(image ? ['-i', cover] : []), ...media.flatMap(stream => ['-map', `0:${stream.index}`]), ...(image ? ['-map', '1:v:0'] : []),
        '-c', 'copy', '-map_metadata', '0', '-map_chapters', '0',
        ...(image ? [`-disposition:v:${videoCount}`, 'attached_pic', `-metadata:s:v:${videoCount}`, 'title=Album cover', `-metadata:s:v:${videoCount}`, 'comment=Cover (front)'] : []),
        ...(extension === '.mp3' ? ['-id3v2_version', '3'] : []),
        ...(extension === '.mp4' ? ['-movflags', '+faststart'] : []),
        '-f', extension === '.m4a' ? 'ipod' : extension.slice(1), candidate])
      const result = await probe(candidate), streams = result.streams ?? []
      const copied = streams.filter(stream => !stream.disposition?.attached_pic)
      const duration = Number(original.format?.duration), newDuration = Number(result.format?.duration)
      const attributes = ['codec_type', 'codec_name', 'sample_rate', 'channels', 'width', 'height'] as const
      if (copied.length !== media.length || media.some((stream, index) => attributes.some(attribute => stream[attribute] !== copied[index]?.[attribute]))
        || !Number.isFinite(duration) || !Number.isFinite(newDuration) || Math.abs(duration - newDuration) > .25
        || streams.filter(stream => stream.disposition?.attached_pic).length !== (image ? 1 : 0)) throw new Error('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED')
      // Sync the completed file before promotion; never write over the source in place.
      await fs.chmod(candidate, before.mode)
      const handle = await fs.open(candidate, 'r+')
      try { await handle.sync() } finally { await handle.close() }
      await fs.copyFile(source, backup, constants.COPYFILE_EXCL)
      const current = await fs.stat(source)
      if (this.stopped || await fs.realpath(file) !== source || current.size !== before.size || current.mtimeMs !== before.mtimeMs || current.ino !== before.ino) throw new Error('MEDIA_LIBRARY_ARTWORK_FILE_CHANGED')
      await fs.rename(candidate, source); replaced = true
      await persist()
    } catch (error) {
      if (replaced) {
        try { await fs.rename(backup, source) }
        catch { preserveBackup = true; throw new Error(`MEDIA_LIBRARY_ARTWORK_RECOVERY: ${backup}`) }
      }
      if (error instanceof Error && error.message.includes('MEDIA_LIBRARY_')) throw error
      throw new Error('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED')
    } finally {
      await fs.unlink(candidate).catch(() => {})
      await fs.unlink(cover).catch(() => {})
      if (!preserveBackup) await fs.unlink(backup).catch(() => {})
    }
    // Refresh the shell only after both the file and library commit succeeded.
    // A shell/cache failure must not roll back an already saved media file.
    if (!this.stopped) {
      if (refreshPlayer) {
        try { await this.refreshPlayer(source, artworkMetadata) } catch { /* Player cache refresh is optional. */ }
      }
      if (this.stopped) return
      try { await this.refresh(source) } catch { /* Optional shell notification cannot undo a committed edit. */ }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.waiting.splice(0).forEach(resolve => resolve())
    for (const child of this.children) child.kill()
    await Promise.allSettled([...this.pending, ...this.inspections.values()])
  }
}
