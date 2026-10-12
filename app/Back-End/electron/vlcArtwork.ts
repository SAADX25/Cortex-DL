import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export type VlcArtworkMetadata = { title?: string; artist?: string; album?: string; attachmentCount?: number }
export function vlcArtworkMetadata(tags: Record<string, string> | undefined, attachmentCount: number): VlcArtworkMetadata {
  // ffprobe preserves uppercase FLAC/Vorbis tag names; VLC treats them without case sensitivity.
  const normalized = Object.fromEntries(Object.entries(tags ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
  return { title: normalized.title, artist: normalized.artist, album: normalized.album, attachmentCount }
}
const validTag = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32767 && !value.includes('\0')
const samePath = (a: string, b: string) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
const artName = /^art(?:\.(?:jpe?g|png|webp|gif|bmp))?$/i

// VLC 3's filename_sanitize and attachment URL + title cache identities.
// https://github.com/videolan/vlc/blob/3.0.x/src/playlist/art.c
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

/** Back up matching VLC images/references without closing VLC or resetting its preferences. */
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
    // Older VLC releases retain pointers to cached images by input UID. Only
    // references to the matched artwork directories are eligible for refresh.
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
  } catch { return 0 } // Optional cache work cannot fail a successfully saved cover.
}
