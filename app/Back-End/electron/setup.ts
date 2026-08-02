import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
// Pipeline is dynamically imported inside the function
import { spawn } from 'node:child_process'
import log from 'electron-log'
import { getBinDirectory } from './paths'

export interface SetupState {
  status: 'checking' | 'downloading' | 'extracting' | 'done' | 'error'
  progress: number
  message: string
}

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
// Using BtbN's automated FFmpeg builds
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
const DENO_URL = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'

export async function runSetup(win: BrowserWindow): Promise<void> {
  const binDir = getBinDirectory()

  const sendProgress = (state: SetupState) => {
    if (!win.isDestroyed()) {
      win.webContents.send('cortexdl:setup-progress', state)
    }
  }

  try {
    sendProgress({ status: 'checking', progress: 0, message: 'Checking environment...' })

    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true })
    }

    const ytdlpPath = path.join(binDir, 'yt-dlp.exe')
    const ffmpegPath = path.join(binDir, 'ffmpeg.exe')
    const ffprobePath = path.join(binDir, 'ffprobe.exe')
    const denoPath = path.join(binDir, 'deno.exe')

    const needsYtdlp = !fs.existsSync(ytdlpPath)
    const needsFfmpeg = !fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)
    const needsDeno = !fs.existsSync(denoPath)

    if (!needsYtdlp && !needsFfmpeg && !needsDeno) {
      log.info('[Setup] All binaries are present.')
      sendProgress({ status: 'done', progress: 100, message: 'Ready' })
      return
    }

    log.info('[Setup] Missing binaries, starting download...')

    // Download yt-dlp
    if (needsYtdlp) {
      await downloadFile(
        YTDLP_URL,
        ytdlpPath,
        (pct) => sendProgress({ status: 'downloading', progress: Math.round(pct / 2), message: 'Downloading yt-dlp...' })
      )
    }

    // Download and extract FFmpeg (includes ffprobe)
    if (needsFfmpeg) {
      const zipPath = path.join(binDir, 'ffmpeg.zip')
      
      await downloadFile(
        FFMPEG_URL,
        zipPath,
        (pct) => sendProgress({ status: 'downloading', progress: 30 + Math.round(pct * 0.3), message: 'Downloading FFmpeg...' })
      )

      sendProgress({ status: 'extracting', progress: 60, message: 'Extracting FFmpeg...' })
      await extractFfmpeg(zipPath, binDir, ffmpegPath)
      
      // Cleanup zip
      fs.unlinkSync(zipPath)
    }

    // Download and extract Deno
    if (needsDeno) {
      const zipPath = path.join(binDir, 'deno.zip')
      
      await downloadFile(
        DENO_URL,
        zipPath,
        (pct) => sendProgress({ status: 'downloading', progress: 70 + Math.round(pct * 0.2), message: 'Downloading Deno...' })
      )

      sendProgress({ status: 'extracting', progress: 95, message: 'Extracting Deno...' })
      await extractDeno(zipPath, binDir, denoPath)
      
      // Cleanup zip
      fs.unlinkSync(zipPath)
    }

    log.info('[Setup] Setup completed successfully.')
    sendProgress({ status: 'done', progress: 100, message: 'Setup complete!' })
  } catch (err: any) {
    log.error('[Setup] Error during setup:', err)
    sendProgress({ status: 'error', progress: 0, message: err.message || 'Unknown error during setup' })
    throw err
  }
}

async function downloadFile(url: string, finalPath: string, onProgress: (pct: number) => void): Promise<void> {
  const tmpPath = `${finalPath}.tmp`
  log.info(`[Setup] Downloading ${url} to ${tmpPath}`)

  let attempt = 0
  const maxAttempts = 3

  while (attempt < maxAttempts) {
    attempt++
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'CortexDL-App/1.0 (Windows)'
        }
      })
      
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
      }

      const totalBytes = parseInt(response.headers.get('content-length') || '0', 10)
      let downloadedBytes = 0

      const fileStream = fs.createWriteStream(tmpPath)
      const { Transform } = await import('node:stream')

      const progressStream = new Transform({
        transform(chunk, _encoding, callback) {
          downloadedBytes += chunk.length
          if (totalBytes > 0) {
            const pct = (downloadedBytes / totalBytes) * 100
            onProgress(pct)
          }
          callback(null, chunk)
        }
      })

      const { Readable } = await import('node:stream')
      const webStream = response.body as unknown as import('stream/web').ReadableStream
      
      const { pipeline } = await import('node:stream/promises')
      await pipeline(Readable.fromWeb(webStream), progressStream, fileStream)

      fs.renameSync(tmpPath, finalPath)
      log.info(`[Setup] Successfully saved to ${finalPath}`)
      return // Success, break out of loop
    } catch (err: any) {
      log.error(`[Setup] Download attempt ${attempt} failed for ${url}:`, err)
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
      }
      if (attempt >= maxAttempts) {
        throw new Error(`Failed to download after ${maxAttempts} attempts: ${err.message}`)
      }
      // Wait before retrying
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

async function extractFfmpeg(zipPath: string, binDir: string, finalFfmpegPath: string): Promise<void> {
  log.info(`[Setup] Extracting FFmpeg from ${zipPath}`)
  const tmpExtractedDir = path.join(binDir, 'ffmpeg-extract-tmp')
  
  if (fs.existsSync(tmpExtractedDir)) {
    fs.rmSync(tmpExtractedDir, { recursive: true, force: true })
  }
  fs.mkdirSync(tmpExtractedDir, { recursive: true })

  try {
    // Windows 10+ includes tar
    await new Promise<void>((resolve, reject) => {
      const tarProc = spawn('tar', ['-xf', zipPath, '-C', tmpExtractedDir], {
        windowsHide: true,
      })

      let errOutput = ''
      tarProc.stderr.on('data', (d) => errOutput += d.toString())

      tarProc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar extraction failed (code ${code}): ${errOutput}`))
      })
      tarProc.on('error', reject)
    })

    // Find ffmpeg.exe inside the extracted folder
    const findFfmpeg = (dir: string): string | null => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const found = findFfmpeg(fullPath)
          if (found) return found
        } else if (entry.name.toLowerCase() === 'ffmpeg.exe') {
          return fullPath
        }
      }
      return null
    }

    const extractedFfmpeg = findFfmpeg(tmpExtractedDir)
    if (!extractedFfmpeg) {
      throw new Error('ffmpeg.exe not found in the extracted archive')
    }

    // Move to final location
    fs.renameSync(extractedFfmpeg, finalFfmpegPath)
    
    // Attempt to also move ffprobe if it exists
    const extractedFfprobe = path.join(path.dirname(extractedFfmpeg), 'ffprobe.exe')
    if (fs.existsSync(extractedFfprobe)) {
      fs.renameSync(extractedFfprobe, path.join(binDir, 'ffprobe.exe'))
    }
    
    log.info('[Setup] FFmpeg extracted successfully.')
  } finally {
    // Cleanup extraction folder
    if (fs.existsSync(tmpExtractedDir)) {
      try { fs.rmSync(tmpExtractedDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }
}

async function extractDeno(zipPath: string, binDir: string, finalDenoPath: string): Promise<void> {
  log.info(`[Setup] Extracting Deno from ${zipPath}`)
  const tmpExtractedDir = path.join(binDir, 'deno-extract-tmp')
  
  if (fs.existsSync(tmpExtractedDir)) {
    fs.rmSync(tmpExtractedDir, { recursive: true, force: true })
  }
  fs.mkdirSync(tmpExtractedDir, { recursive: true })

  try {
    await new Promise<void>((resolve, reject) => {
      const tarProc = spawn('tar', ['-xf', zipPath, '-C', tmpExtractedDir], {
        windowsHide: true,
      })

      let errOutput = ''
      tarProc.stderr.on('data', (d) => errOutput += d.toString())

      tarProc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar extraction failed (code ${code}): ${errOutput}`))
      })
      tarProc.on('error', reject)
    })

    const extractedDeno = path.join(tmpExtractedDir, 'deno.exe')
    if (!fs.existsSync(extractedDeno)) {
      throw new Error('deno.exe not found in the extracted archive')
    }

    fs.renameSync(extractedDeno, finalDenoPath)
    log.info('[Setup] Deno extracted successfully.')
  } finally {
    if (fs.existsSync(tmpExtractedDir)) {
      try { fs.rmSync(tmpExtractedDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }
}
