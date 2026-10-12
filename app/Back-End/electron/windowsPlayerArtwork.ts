import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'

// This is a private Media Player cache format, confirmed on Windows 11.
// Unknown formats are skipped; never fall back to clearing the whole cache.
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

/** Only a graceful close of the verified Microsoft app; no forced termination. */
export async function closeWindowsMediaPlayer(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const binary = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise(resolve => execFile(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(closeScript, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 7000, maxBuffer: 8192 }, error => resolve(!error)))
}

async function plainDirectory(directory: string): Promise<boolean> {
  const stat = await fs.lstat(directory)
  return stat.isDirectory() && !stat.isSymbolicLink()
}

/** Retain one backup per cached image, and leave the media library database untouched. */
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
      // Recheck both files after closing the player. Never follow a cache link.
      const sourceStat = await fs.lstat(source).catch(() => null), targetStat = await fs.lstat(target).catch(() => null)
      if (!sourceStat?.isFile() || sourceStat.isSymbolicLink() || targetStat && (!targetStat.isFile() || targetStat.isSymbolicLink())) continue
      await fs.rename(source, target)
      refreshed++
    }
    return refreshed
  } catch { return 0 } // A cache failure cannot turn a saved cover into a failed edit.
}
