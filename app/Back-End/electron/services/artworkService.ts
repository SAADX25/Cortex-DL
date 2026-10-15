import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { spawn, type ChildProcess, execFile } from 'node:child_process'
import { canEmbedLibraryArtwork } from '../../../Shared/mediaLibrary'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Probe = { format?: { duration?: string; tags?: Record<string, string> }; streams?: { index: number; codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; width?: number; height?: number; disposition?: { attached_pic?: number } }[] }

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
      child.once('error', () => {  })
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

    if (!this.stopped) {
      if (refreshPlayer) {
        await this.refreshPlayer(source, artworkMetadata).catch(() => {})
      }
      if (this.stopped) return
      await this.refresh(source).catch(() => {})
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.waiting.splice(0).forEach(resolve => resolve())
    for (const child of this.children) child.kill()
    await Promise.allSettled([...this.pending, ...this.inspections.values()])
  }
}

// Paths travel through the environment, never through executable PowerShell source.
const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CortexArtworkShell {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(int eventId, uint flags, string item1, IntPtr item2);
}
'@
# SHCNE_UPDATEITEM; SHCNF_PATHW | SHCNF_FLUSHNOWAIT.
[CortexArtworkShell]::SHChangeNotify(0x00002000, 0x00002005, $env:CORTEX_ARTWORK_FILE, [IntPtr]::Zero)
`

export async function refreshArtworkFile(file: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  if (!path.isAbsolute(file) || file.includes('\0')) return false
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise<boolean>(resolve => {
    execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 5000, maxBuffer: 8192,
      env: { ...process.env, CORTEX_ARTWORK_FILE: file },
    }, error => resolve(!error))
  })
}

export async function refreshExternalPlayerArtwork(file: string, metadata: VlcArtworkMetadata): Promise<void> {
  await Promise.allSettled([refreshWindowsPlayerArtwork(file), refreshVlcArtwork(file, metadata)])
}

export type VlcArtworkMetadata = { title?: string; artist?: string; album?: string; attachmentCount?: number }

export function vlcArtworkMetadata(tags: Record<string, string> | undefined, attachmentCount: number): VlcArtworkMetadata {
  const normalized = Object.fromEntries(Object.entries(tags ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
  return { title: normalized.title, artist: normalized.artist, album: normalized.album, attachmentCount }
}

const validTag = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32767 && !value.includes('\0')

const samePath = (a: string, b: string) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()

const artName = /^art(?:\.(?:jpe?g|png|webp|gif|bmp))?$/i

// VLC 3's filename_sanitize and attachment URL + title cache identities.

function sanitize(value: string): string {
  if (value === '.' || value === '..') return '_'.repeat(value.length)
  return Array.from(value, character => character.charCodeAt(0) < 32 || '/\\:*"?|<>'.includes(character) ? '_' : character).join('')
    .replace(/^ +| +$/g, spaces => '_'.repeat(spaces.length))
}

export function vlcArtworkDirectories(file: string, metadata: VlcArtworkMetadata): string[] {
  if (!path.isAbsolute(file) || file.includes('\0')) return []
  if (validTag(metadata.artist) && validTag(metadata.album)) {
    const artist = sanitize(metadata.artist), album = sanitize(metadata.album)
    return artist.length <= 255 && album.length <= 255 ? [path.join('art', 'artistalbum', artist, album)] : []
  }
  const title = validTag(metadata.title) ? metadata.title : path.basename(file)
  const count = Number.isInteger(metadata.attachmentCount) ? Math.max(1, Math.min(32, metadata.attachmentCount!)) : 1
  const attachments = [...Array.from({ length: count }, (_, index) => String(index)), 'cover']
  return attachments.map(name => path.join('art', 'arturl', createHash('md5').update(`attachment://${name}${title}`, 'utf8').digest('hex')))
}

async function plainDirectory(directory: string): Promise<boolean> {
  const stat = await fs.lstat(directory).catch(() => null)
  return !!stat?.isDirectory() && !stat.isSymbolicLink()
}

async function plainFile(file: string, limit: number): Promise<boolean> {
  const stat = await fs.lstat(file).catch(() => null)
  return !!stat?.isFile() && !stat.isSymbolicLink() && stat.size <= limit
}

function referencePath(value: string): string | null {
  const url = value.trim()
  if (!url.startsWith('file://') || url.includes('\0')) return null
  // VLC 3 also writes raw Windows paths after file://, without URI escaping.
  const raw = url.slice(7)
  if (/^[a-z]:[/\\]/i.test(raw)) return raw
  try { return fileURLToPath(url) } catch {
    return path.isAbsolute(raw) ? raw : null
  }
}

export async function refreshVlcArtwork(file: string, metadata: VlcArtworkMetadata, appData = process.env.APPDATA): Promise<number> {
  if (process.platform !== 'win32' || !appData || !path.isAbsolute(appData)) return 0
  try {
    const relative = vlcArtworkDirectories(file, metadata)
    if (!relative.length) return 0
    const root = path.join(appData, 'vlc'), backups = path.join(root, 'CortexArtworkBackups')
    if (!await plainDirectory(appData) || !await plainDirectory(root)) return 0
    const targets: string[] = [], directories: string[] = []
    for (const entry of relative) {
      let directory = root, safe = true
      for (const component of entry.split(path.sep)) {
        directory = path.join(directory, component)
        if (!await plainDirectory(directory)) { safe = false; break }
      }
      if (!safe) continue
      directories.push(directory)
      const entries = await fs.readdir(directory, { withFileTypes: true })
      if (entries.length > 64) continue
      for (const entry of entries) if (entry.isFile() && artName.test(entry.name)) targets.push(path.join(directory, entry.name))
    }

    const index = path.join(root, 'by-iiuid')
    if (directories.length && await plainDirectory(index)) {
      const entries = await fs.readdir(index, { withFileTypes: true })
      if (entries.length <= 10000) for (let offset = 0; offset < entries.length; offset += 32) {
        const references = await Promise.all(entries.slice(offset, offset + 32).map(async entry => {
          if (!entry.isDirectory() || !/^[a-f0-9]{32}$/i.test(entry.name)) return null
          const directory = path.join(index, entry.name), reference = path.join(directory, 'arturl')
          if (!await plainDirectory(directory) || !await plainFile(reference, 4096)) return null
          const target = referencePath(await fs.readFile(reference, 'utf8'))
          return target && artName.test(path.basename(target)) && directories.some(directory => samePath(path.dirname(target), directory)) ? reference : null
        }))
        for (const reference of references) if (reference) targets.push(reference)
      }
    }
    if (!targets.length) return 0
    await fs.mkdir(backups).catch(error => { if (error.code !== 'EEXIST') throw error })
    if (!await plainDirectory(backups)) return 0
    let refreshed = 0
    for (const source of targets) {
      const name = createHash('sha256').update(path.relative(root, source).toLowerCase()).digest('hex') + '-' + path.basename(source)
      const target = path.join(backups, name), targetStat = await fs.lstat(target).catch(() => null)
      if (targetStat && (!targetStat.isFile() || targetStat.isSymbolicLink())) continue
      if (!await plainFile(source, source.endsWith(`${path.sep}arturl`) ? 4096 : 8 * 1024 * 1024)) continue
      await fs.rename(source, target).then(() => { refreshed++ }, () => {})
    }
    return refreshed
  } catch { return 0 }
}

// This is a private Media Player cache format, confirmed on Windows 11.

export function windowsPlayerArtworkPrefixes(file: string): string[] {
  const identities = new Set([file, path.normalize(file), file.toLowerCase(), pathToFileURL(file).href])
  return [...identities].map(identity => createHash('sha256').update(identity, 'utf8').digest('hex').match(/../g)!.join('-').toUpperCase())
}

const closeScript = `
$ErrorActionPreference = 'Stop'
$players = @(Get-Process -Name 'Microsoft.Media.Player' -ErrorAction SilentlyContinue)
foreach ($player in $players) {
    $exe = $player.Path
    $apps = Join-Path $env:ProgramFiles 'WindowsApps'
    if (!$exe -or ![IO.Path]::GetDirectoryName($exe).StartsWith($apps + '\\', [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($exe)) -notmatch '^Microsoft\\.ZuneMusic_[^\\\\]+_8wekyb3d8bbwe$' -or
        [IO.Path]::GetFileName($exe) -ne 'Microsoft.Media.Player.exe') { exit 1 }
}
foreach ($player in $players) {
    if (!$player.HasExited -and (!$player.CloseMainWindow() -or !$player.WaitForExit(2000))) { exit 1 }
}
if (Get-Process -Name 'Microsoft.Media.Player' -ErrorAction SilentlyContinue) { exit 1 }
`

export async function closeWindowsMediaPlayer(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const binary = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise(resolve => execFile(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(closeScript, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 7000, maxBuffer: 8192 }, error => resolve(!error)))
}

export async function refreshWindowsPlayerArtwork(file: string, localAppData = process.env.LOCALAPPDATA,
  closePlayer: () => Promise<boolean> = closeWindowsMediaPlayer): Promise<number> {
  if (process.platform !== 'win32' || !path.isAbsolute(file) || file.includes('\0') || !localAppData || !path.isAbsolute(localAppData)) return 0
  try {
    const packages = path.join(localAppData, 'Packages'), app = path.join(packages, 'Microsoft.ZuneMusic_8wekyb3d8bbwe')
    const cache = path.join(app, 'LocalCache'), images = path.join(cache, 'Image'), backups = path.join(cache, 'CortexArtworkBackups')
    for (const directory of [localAppData, packages, app, cache, images]) if (!await plainDirectory(directory)) return 0
    const prefixes = windowsPlayerArtworkPrefixes(file)
    const entries = await fs.readdir(images, { withFileTypes: true })
    if (entries.length > 50000) return 0
    const matches = entries.filter(entry => entry.isFile() && prefixes.some(prefix => entry.name.startsWith(prefix + '-') && /^\d{1,3}-\d{1,5}-\d{1,5}$/.test(entry.name.slice(prefix.length + 1))))
    if (!matches.length) return 0
    await fs.mkdir(backups).catch(error => { if (error.code !== 'EEXIST') throw error })
    if (!await plainDirectory(backups) || !await closePlayer()) return 0
    let refreshed = 0
    for (const entry of matches) {
      const source = path.join(images, entry.name), target = path.join(backups, entry.name)

      const sourceStat = await fs.lstat(source).catch(() => null), targetStat = await fs.lstat(target).catch(() => null)
      if (!sourceStat?.isFile() || sourceStat.isSymbolicLink() || targetStat && (!targetStat.isFile() || targetStat.isSymbolicLink())) continue
      await fs.rename(source, target)
      refreshed++
    }
    return refreshed
  } catch { return 0 }
}
