import { promises as fs, createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import AdmZip from 'adm-zip'
import { SUBTITLE_ASSETS, type SubtitleAsset } from './manifest'
import type { SpeechModel, TranslationModel, SubtitleReadiness } from '../../../Shared/localSubtitles'

type Receipt = { id: string; sha256: string; executable?: string; files: { name: string; size: number; mtimeMs: number }[] }
export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export class SubtitleAssets {
  constructor(readonly root: string) {}
  private receiptPath(asset: SubtitleAsset): string { return path.join(this.root, `${asset.id}.receipt.json`) }
  async locate(key: string): Promise<string | null> {
    const asset = SUBTITLE_ASSETS[key]
    try {
      const receipt: Receipt = JSON.parse(await fs.readFile(this.receiptPath(asset), 'utf8'))
      if (receipt.id !== asset.id || receipt.sha256 !== asset.sha256 || !receipt.files?.length) return null
      for (const file of receipt.files) {
        const target = path.resolve(this.root, file.name)
        if (!target.startsWith(path.resolve(this.root) + path.sep)) return null
        const stat = await fs.lstat(target)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs) return null
      }
      const name = asset.archive ? receipt.executable : asset.file
      if (!name || !receipt.files.some(f => f.name === name)) return null
      return path.join(this.root, name)
    } catch { return null }
  }
  async readiness(): Promise<SubtitleReadiness> {
    const keys = ['whisper', 'vad', 'accurate', 'fast', 'llama', 'standard', 'quality']
    const found = Object.fromEntries(await Promise.all(keys.map(async key => [key, !!await this.locate(key)])))
    return { speech: { accurate: found.whisper && found.vad && found.accurate, fast: found.whisper && found.vad && found.fast },
      translation: { standard: found.llama && found.standard, quality: found.llama && found.quality }, ramGB: os.totalmem() / 1073741824 }
  }
  async install(speech: SpeechModel, translation: TranslationModel | null, signal: AbortSignal, progress: (percent: number, name: string) => void): Promise<void> {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('LOCAL_SUBTITLES_WINDOWS_X64')
    await fs.mkdir(this.root, { recursive: true })
    const selected = ['whisper', 'vad', speech, ...(translation ? ['llama', translation] : [])]
    const missing: SubtitleAsset[] = []
    for (const key of selected) { signal.throwIfAborted(); if (!await this.locate(key)) missing.push(SUBTITLE_ASSETS[key]) }
    const total = missing.reduce((n, a) => n + a.bytes, 0)
    // Archives are tiny compared with model weights; reserve space for extraction too.
    const space = await fs.statfs(this.root)
    if (Number(space.bavail) * Number(space.bsize) < total + 100 * 1024 * 1024) throw new Error('LOCAL_SUBTITLES_DISK_SPACE')
    let done = 0
    for (const asset of missing) {
      await this.installAsset(asset, signal, bytes => progress(Math.min(99, (done + bytes) / total * 100), asset.id))
      done += asset.bytes
    }
    progress(100, 'ready')
  }
  private async installAsset(asset: SubtitleAsset, signal: AbortSignal, progress: (bytes: number) => void): Promise<void> {
    const partial = path.join(this.root, `${asset.id}.download.part`)
    let offset = await fs.stat(partial).then(s => s.size, () => 0)
    if (offset > asset.bytes) { await fs.rm(partial, { force: true }); offset = 0 }
    if (offset < asset.bytes) {
      const response = await fetch(asset.url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal })
      if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`)
      if (offset && response.status === 206) {
        if (!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) throw new Error('Invalid model download range')
      } else offset = 0
      const handle = await fs.open(partial, offset ? 'a' : 'w')
      const reader = response.body.getReader()
      let bytes = offset, emitted = 0
      try {
        for (;;) {
          signal.throwIfAborted()
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.length
          if (bytes > asset.bytes) throw new Error('Model download exceeds expected size')
          let written = 0
          while (written < value.length) written += (await handle.write(value, written, value.length - written)).bytesWritten
          if (Date.now() - emitted > 200) { progress(bytes); emitted = Date.now() }
        }
      } finally { await reader.cancel().catch(() => {}); await handle.close() }
    }
    signal.throwIfAborted()
    if ((await fs.stat(partial)).size !== asset.bytes || await sha256(partial) !== asset.sha256) {
      await fs.rm(partial, { force: true }); throw new Error('Model checksum verification failed')
    }
    signal.throwIfAborted()
    const names: string[] = []
    let executable: string | undefined
    if (asset.archive) {
      const stage = path.join(this.root, `.install-${randomUUID()}`)
      await fs.mkdir(stage)
      try {
        const archive = new AdmZip(partial)
        let expanded = 0
        for (const entry of archive.getEntries()) {
          signal.throwIfAborted()
          const relative = entry.entryName.replace(/\\/g, '/')
          const target = path.resolve(stage, relative)
          if (!target.startsWith(stage + path.sep) || ((entry.header.attr >>> 16) & 0xF000) === 0xA000) throw new Error('Unsafe engine archive')
          if (entry.isDirectory) continue
          expanded += entry.header.size
          if (expanded > 200 * 1024 * 1024) throw new Error('Engine archive exceeds size limit')
          await fs.mkdir(path.dirname(target), { recursive: true })
          await fs.writeFile(target, entry.getData(), { flag: 'wx' })
          names.push(path.join(asset.file, relative))
          if (path.basename(target) === asset.executable) executable = path.join(asset.file, relative)
        }
        if (!executable) throw new Error('Engine executable missing from archive')
        const destination = path.join(this.root, asset.file)
        // Root and names are fixed in the checked-in manifest, never supplied by renderer.
        await fs.rm(destination, { recursive: true, force: true })
        await fs.rename(stage, destination)
      } finally { await fs.rm(stage, { recursive: true, force: true }) }
      await fs.rm(partial, { force: true })
    } else {
      await fs.rename(partial, path.join(this.root, asset.file))
      names.push(asset.file)
    }
    const files = await Promise.all(names.map(async name => { const stat = await fs.stat(path.join(this.root, name)); return { name, size: stat.size, mtimeMs: stat.mtimeMs } }))
    const receipt: Receipt = { id: asset.id, sha256: asset.sha256, executable, files }
    await fs.writeFile(this.receiptPath(asset) + '.tmp', JSON.stringify(receipt))
    await fs.rename(this.receiptPath(asset) + '.tmp', this.receiptPath(asset))
  }
}
