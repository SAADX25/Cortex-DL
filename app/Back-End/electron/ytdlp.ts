import { spawn } from 'node:child_process'
import type { AnalyzeResult } from './types'
import log from 'electron-log'
import path from 'node:path'
import { existsSync, createWriteStream } from 'node:fs'
import { get } from 'node:https'
import { chmodSync } from 'node:fs'
import { unlink, rename, stat } from 'node:fs/promises'
import { getBinaryPath, getBinDirectory, getCookiesPath } from './paths'

/* ═══════════════════════════════════════════════════════════════════════════
   In-Memory Analysis Cache (LRU with 5-minute TTL)
   Stores parsed AnalyzeResult keyed by normalized URL.
   Same URL within 5 min returns instantly without spawning yt-dlp.
   ═══════════════════════════════════════════════════════════════════════════ */
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const ANALYSIS_CACHE_MAX = 50 // max entries to prevent unbounded growth

interface CacheEntry {
  result: AnalyzeResult
  timestamp: number
}

const analysisCache = new Map<string, CacheEntry>()

function normalizeUrlForCache(url: string): string {
  // Strip trailing slashes, whitespace, and lowercase the host for consistent keys
  return url.trim().replace(/\/+$/, '')
}

function getCachedAnalysis(url: string): AnalyzeResult | null {
  const key = normalizeUrlForCache(url)
  const entry = analysisCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > ANALYSIS_CACHE_TTL_MS) {
    analysisCache.delete(key)
    return null
  }
  log.info(`[ytdlp] Cache HIT for: ${key.slice(0, 80)}...`)
  return entry.result
}

function setCachedAnalysis(url: string, result: AnalyzeResult): void {
  const key = normalizeUrlForCache(url)
  // Evict oldest entries if at capacity
  if (analysisCache.size >= ANALYSIS_CACHE_MAX) {
    const oldestKey = analysisCache.keys().next().value
    if (oldestKey) analysisCache.delete(oldestKey)
  }
  analysisCache.set(key, { result, timestamp: Date.now() })
}



export async function isYtdlpAvailable(): Promise<boolean> {
  try {
    const p = spawn(getBinaryPath('yt-dlp'), ['--version'], { windowsHide: true, detached: false })
    const exitCode: number = await new Promise((resolve) => {
      p.on('close', (code) => resolve(code ?? 1))
      p.on('error', () => resolve(1))
    })
    return exitCode === 0
  } catch {
    return false
  }
}

export async function getYtdlpVersion(): Promise<string> {
  const TIMEOUT_MS = 5000 // 5 second timeout
  
  try {
    const binaryPath = getBinaryPath('yt-dlp')
    log.info(`[ytdlp] Checking version at: ${binaryPath}`)
    
    if (!existsSync(binaryPath)) {
      log.info('[ytdlp] Binary not found')
      return 'Not Installed'
    }
    
    const p = spawn(binaryPath, ['--version'], { 
      windowsHide: true, 
      detached: false,
      timeout: TIMEOUT_MS 
    })
    
    let stdout = ''
    p.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    
    const exitCode: number = await Promise.race([
      new Promise<number>((resolve) => {
        p.on('close', (code) => resolve(code ?? 1))
        p.on('error', () => resolve(1))
      }),
      new Promise<number>((resolve) => {
        setTimeout(() => {
          try { p.kill() } catch { /* ignore */ }
          resolve(1)
        }, TIMEOUT_MS)
      })
    ])
    
    if (exitCode === 0 && stdout.trim()) {
      return stdout.trim()
    }
    return 'Unknown'
  } catch (err) {
    log.error('[ytdlp] Version check error:', err)
    return 'Error'
  }
}

/**
 * Fetches JSON from a URL using HTTPS with redirect support
 */
function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Cortex-DL-App',
        'Accept': 'application/vnd.github.v3+json'
      }
    }
    
    const handleResponse = (response: any) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        if (response.headers.location) {
          get(response.headers.location, options as any, handleResponse).on('error', reject)
        } else {
          reject(new Error('Redirect without location'))
        }
        return
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      
      let data = ''
      response.on('data', (chunk: string) => { data += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('Invalid JSON'))
        }
      })
    }
    
    get(url, options as any, handleResponse).on('error', reject)
  })
}

/**
 * Downloads a file from a URL with redirect support
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Cortex-DL-App'
      }
    }
    
    const handleResponse = (response: any) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        if (response.headers.location) {
          get(response.headers.location, options as any, handleResponse).on('error', reject)
        } else {
          reject(new Error('Redirect without location'))
        }
        return
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      
      const file = createWriteStream(destPath)
      
      const totalSize = parseInt(response.headers['content-length'] || '0', 10)
      let downloaded = 0
      let lastLogTime = Date.now()

      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        const now = Date.now()
        if (now - lastLogTime > 2000) {
          const percent = totalSize ? ((downloaded / totalSize) * 100).toFixed(1) : '?'
          const mb = (downloaded / (1024 * 1024)).toFixed(2)
          log.info(`[ytdlp updater] Download progress: ${mb}MB (${percent}%)`)
          lastLogTime = now
        }
      })

      response.pipe(file)

      file.on('finish', () => {
        log.info(`[ytdlp updater] Finished downloading to ${destPath}`)
        file.close()
        resolve()
      })
      file.on('error', (err: Error) => {
        log.error(`[ytdlp updater] Failed to write download:`, err)
        file.close()
        reject(err)
      })
    }
    
    get(url, options as any, handleResponse).on('error', reject)
  })
}

export async function updateYtdlp(): Promise<{ success: boolean; message: string; version?: string }> {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Auto-update is only available on Windows.' }
  }

  const binDir = getBinDirectory()
  const binaryPath = path.join(binDir, 'yt-dlp.exe')
  const tempPath = path.join(binDir, 'yt-dlp_new.exe')
  
  log.info(`[ytdlp] Update: binDir=${binDir}, binaryPath=${binaryPath}`)

  try {
    // Step 1: Fetch latest release info from GitHub API
    log.info('[ytdlp] Fetching latest release from GitHub...')
    const releaseData = await fetchJson('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')
    
    const latestVersion = releaseData.tag_name || releaseData.name
    log.info(`[ytdlp] Latest version: ${latestVersion}`)
    
    // Find the Windows executable asset
    const asset = releaseData.assets?.find((a: any) => 
      a.name === 'yt-dlp.exe' || a.name === 'yt-dlp_win.exe'
    )
    
    if (!asset || !asset.browser_download_url) {
      return { success: false, message: 'Could not find Windows executable in release.' }
    }
    
    const downloadUrl = asset.browser_download_url
    log.info(`[ytdlp] Download URL: ${downloadUrl}`)
    
    // Step 2: Download new binary to temp file
    log.info('[ytdlp] Downloading new binary...')
    await downloadFile(downloadUrl, tempPath)
    
    // Verify download succeeded
    if (!existsSync(tempPath)) {
      return { success: false, message: 'Download failed - temp file not created.' }
    }
    
const stats = await stat(tempPath)
    if (stats.size < 1000000) { // yt-dlp.exe should be at least 1MB
      await unlink(tempPath).catch(() => {})
      return { success: false, message: 'Download appears corrupted (file too small).' }
    }

    // Step 3: Delete old binary (if exists)
    log.info('[ytdlp] Replacing old binary...')
    if (existsSync(binaryPath)) {
      try {
        await unlink(binaryPath)
      } catch (err) {
        // Try to rename old file instead
        try {
          await rename(binaryPath, binaryPath + '.old')
        } catch (renameErr) {
          log.error('======================================================')
          log.error('[yt-dlp UPDATER FATAL ERROR]')
          log.error('Failed to replace the old binary! It is likely locked.')
          log.error('Unlink Error:', err)
          log.error('Rename Error:', renameErr)
          log.error('Binary Path:', binaryPath)
          log.error('======================================================')
          await unlink(tempPath).catch(() => {})
          return { success: false, message: 'Failed to remove old binary. Make sure no downloads are active.' }
        }
      }
    }

    // Step 4: Rename temp to final
    try {
      await rename(tempPath, binaryPath)
    } catch (renameFinalErr) {
      log.error('======================================================')
      log.error('[yt-dlp UPDATER FATAL ERROR]')
      log.error('Failed to rename the new temp binary to the final path!')
      log.error('Rename Error:', renameFinalErr)
      log.error('From:', tempPath, 'To:', binaryPath)
      log.error('======================================================')
      return { success: false, message: 'Failed to rename new binary.' }
    }

    // Step 5: Set executable permissions (for non-Windows)
    try {
      chmodSync(binaryPath, 0o755)
    } catch { /* ignore on Windows */ }
    
    log.info(`[ytdlp] Update successful! Version: ${latestVersion}`)
    return { success: true, message: `Updated successfully to ${latestVersion}!`, version: latestVersion }
    
  } catch (err) {
    log.error('[ytdlp] Update error:', err)
    // Cleanup temp file if exists
    if (existsSync(tempPath)) {
      await unlink(tempPath).catch(() => {})
    }
    return { success: false, message: `Update failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
  }
}

export async function checkJsRuntime(): Promise<{ available: boolean; name: string }> {
  try {
    const args = [...getJsRuntimeArgs(), '--version']
    const p = spawn(getBinaryPath('yt-dlp'), args, { windowsHide: true, detached: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    
    let stderr = ''
    p.stderr.on('data', (data) => stderr += data.toString())
    
    const exitCode: number = await new Promise((resolve) => {
      p.on('close', (code) => resolve(code ?? 1))
      p.on('error', () => resolve(1))
    })

    if (exitCode === 0 && !stderr.includes('No supported JavaScript runtime')) {
      const runtime = getJsRuntimeArgs()[1]
      return { available: true, name: runtime.includes('deno') ? 'Deno' : 'Node' }
    }
    return { available: false, name: 'None' }
  } catch {
    return { available: false, name: 'None' }
  }
}

function isYouTubeUrl(url: string): boolean {
  const low = url.toLowerCase()
  return low.includes('youtube.com') || low.includes('youtu.be')
}

export function getJsRuntimeArgs(): string[] {
  const denoPath = getBinaryPath('deno')
  if (existsSync(denoPath)) {
    return ['--js-runtimes', `deno:${denoPath}`]
  }
  const nodePath = getBinaryPath('node')
  if (existsSync(nodePath)) {
    return ['--js-runtimes', `node:${nodePath}`]
  }
  // Using Electron's executable as Node.js for yt-dlp decryption
  return ['--js-runtimes', `node:${process.execPath}`]
}

export async function analyzeWithYtdlp(url: string, browser?: string, cookieFile?: string): Promise<AnalyzeResult> {
  // ── Cache check: return instantly if we analyzed this URL recently ──
  const cached = getCachedAnalysis(url)
  if (cached) return cached

  const ytdlpPath = getBinaryPath('yt-dlp')
  if (!existsSync(ytdlpPath)) {
    throw new Error('ملف yt-dlp.exe غير موجود في مجلد bin. يرجى التأكد من وجوده.')
  }

  // NOTE: Removed redundant isYtdlpAvailable() spawn — if the binary is broken,
  // the analysis spawn itself will fail and we handle ENOENT/exit-code below.

  return new Promise((resolve, reject) => {
    // ── Aggressive speed flags ──
    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-check-certificate',
      '--geo-bypass',
      '--force-ipv4',
      '--no-warnings',
      '--ignore-errors',
      // Network speed: tight socket timeout + no disk cache (avoids lock contention)
      '--socket-timeout', '10',
      '--no-cache-dir'
    ]

    const jsRuntimeArgs = getJsRuntimeArgs()
    args.push(...jsRuntimeArgs)

    // Cookie Logic: Prioritize manual cookie file in root, then passed cookieFile, then browser
    const globalCookies = getCookiesPath()
    if (globalCookies) {
      log.info(`[ytdlp Analysis] Using global cookies from: ${globalCookies}`)
      args.push('--cookies', globalCookies)
    } else if (cookieFile) {
      args.push('--cookies', cookieFile)
    } else if (browser && browser !== 'none') {
      args.push('--cookies-from-browser', browser)
    }

    args.push(url)

    const startMs = Date.now()
    log.info(`[ytdlp] Spawning analysis for: ${url.slice(0, 80)}...`)

    const p = spawn(getBinaryPath('yt-dlp'), args, { windowsHide: true, detached: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })

    let stdout = ''
    let stderr = ''

    p.stdout.on('data', (data) => {
      const chunk = data.toString()
      stdout += chunk
      log.info(`[ytdlp stdout] ${chunk.trim()}`)
    })
    
    p.stderr.on('data', (data) => {
      const chunk = data.toString()
      stderr += chunk
      log.error(`[ytdlp stderr] ${chunk.trim()}`)
    })

    // Handle spawn errors (e.g., ENOENT if binary is corrupted/missing at runtime)
    p.on('error', (err) => {
      reject(new Error(`فشل تشغيل yt-dlp: ${err.message}`))
    })

    p.on('close', async (code) => {
      const elapsedMs = Date.now() - startMs
      log.info(`[ytdlp] Analysis finished in ${elapsedMs}ms (exit ${code})`)

      if (code !== 0) {
        log.error('yt-dlp analysis failed:', stderr)
        // JS runtime warning may appear on YouTube. Do not hard-fail here; try to surface the real error if any.
        if (isYouTubeUrl(url) && (stderr.includes('Sign in to confirm you') || stderr.includes('not a bot'))) {
          const hasCookies = !!getCookiesPath()
          if (hasCookies) {
            reject(new Error('يوتيوب يطلب تسجيل دخول رغم وجود ملف cookies.txt. قد تكون الكوكيز منتهية الصلاحية.'))
          } else {
            reject(new Error('يوتيوب يطلب تسجيل دخول أو كابتشا (Bot Detection). الحل: ضع ملف "cookies.txt" في مجلد البرنامج أو اختر متصفحك من الإعدادات.'))
          }
          return
        }
        if (stderr.includes('Could not copy Chrome cookie database') || stderr.includes('database is locked')) {
          reject(new Error('خطأ: المتصفح مفتوح وقاعدة البيانات مقفلة. الحل: أغلق المتصفح تماماً، أو الأفضل استخدم ملف "cookies.txt" لتجنب هذه المشكلة.'))
          return
        }
        resolve({ kind: 'unknown' })
        return
      }

      try {
        const info = JSON.parse(stdout)
        log.info(`[ytdlp Debug] Info parsed. Views: ${info.view_count}, Likes: ${info.like_count}, Comments: ${info.comments ? info.comments.length : 0}`)

        // Handle Playlist
        if (info._type === 'playlist') {
          const items = (info.entries || []).map((entry: any) => {
              let extractedThumbnail = entry.thumbnail;
              if (!extractedThumbnail && entry.thumbnails && entry.thumbnails.length > 0) {
                  extractedThumbnail = entry.thumbnails[entry.thumbnails.length - 1].url;
              }
              if (extractedThumbnail) {
                  log.info('Extracted Thumbnail URL:', extractedThumbnail);
              }
              return {
                  id: entry.id,
                  title: entry.title || 'Unknown Title',
                  url: entry.url || entry.webpage_url,
                  thumbnail: extractedThumbnail ? String(extractedThumbnail) : undefined
              };
          })
          const result: AnalyzeResult = {
            kind: 'playlist',
            title: info.title || 'Playlist',
            items
          }
          setCachedAnalysis(url, result)
          resolve(result)
          return
        }

        const formats = (info.formats || [])
          .filter((f: any) => f.vcodec !== 'none' || f.acodec !== 'none')
          .map((f: any) => ({
            formatId: f.format_id,
            ext: f.ext,
            resolution: f.resolution || (f.vcodec !== 'none' ? `${f.width}x${f.height}` : 'audio only'),
            filesize: f.filesize || f.filesize_approx || null,
            description: `${f.format_note || ''} ${f.fps ? f.fps + 'fps' : ''} ${f.tbr ? Math.round(f.tbr) + 'kbps' : ''} ${f.vcodec !== 'none' && f.acodec !== 'none' ? '(Muxed)' : ''}`.trim(),
            tbr: f.tbr || 0,
            height: f.height || 0,
            fps: f.fps || 0
          }))
          // Sort by height descending, then by bitrate (tbr) descending
          .sort((a: any, b: any) => b.height - a.height || b.tbr - a.tbr)

        let extractedThumbnail = info.thumbnail;
        if (!extractedThumbnail && info.thumbnails && info.thumbnails.length > 0) {
            extractedThumbnail = info.thumbnails[info.thumbnails.length - 1].url;
        }

        // Fetch actual dislikes from Return YouTube Dislike API
        let finalDislikes = info.dislike_count;
        if (isYouTubeUrl(url) && info.id) {
          try {
            const rydResponse = await fetchJson(`https://returnyoutubedislikeapi.com/votes?videoId=${info.id}`);
            if (rydResponse && typeof rydResponse.dislikes === 'number') {
              finalDislikes = rydResponse.dislikes;
              log.info(`[RYD API] Fetched actual dislikes: ${finalDislikes}`);
            }
          } catch (rydErr) {
            log.warn('[RYD API] Failed to fetch dislikes:', rydErr);
          }
        }

        const result: AnalyzeResult = {
          kind: 'ytdlp',
          title: info.title || 'Unknown Title',
          thumbnail: extractedThumbnail ? String(extractedThumbnail) : undefined,
          formats,
          views: info.view_count,
          likes: info.like_count,
          dislikes: finalDislikes,
          duration: info.duration
        };

        setCachedAnalysis(url, result);
        resolve(result);
      } catch (err) {
        log.error('Failed to parse yt-dlp output:', err)
        resolve({ kind: 'unknown' })
      }
    })
  })
}

