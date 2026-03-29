import { spawn } from 'node:child_process'
import type { AnalyzeResult } from './types'
import path from 'node:path'
import { existsSync, createWriteStream } from 'node:fs'
import { get } from 'node:https'
import { chmodSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
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
  console.log(`[ytdlp] Cache HIT for: ${key.slice(0, 80)}...`)
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
    console.log(`[ytdlp] Checking version at: ${binaryPath}`)
    
    if (!existsSync(binaryPath)) {
      console.log('[ytdlp] Binary not found')
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
    console.error('[ytdlp] Version check error:', err)
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
      response.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
      file.on('error', (err: Error) => {
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
  
  console.log(`[ytdlp] Update: binDir=${binDir}, binaryPath=${binaryPath}`)

  try {
    // Step 1: Fetch latest release info from GitHub API
    console.log('[ytdlp] Fetching latest release from GitHub...')
    const releaseData = await fetchJson('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')
    
    const latestVersion = releaseData.tag_name || releaseData.name
    console.log(`[ytdlp] Latest version: ${latestVersion}`)
    
    // Find the Windows executable asset
    const asset = releaseData.assets?.find((a: any) => 
      a.name === 'yt-dlp.exe' || a.name === 'yt-dlp_win.exe'
    )
    
    if (!asset || !asset.browser_download_url) {
      return { success: false, message: 'Could not find Windows executable in release.' }
    }
    
    const downloadUrl = asset.browser_download_url
    console.log(`[ytdlp] Download URL: ${downloadUrl}`)
    
    // Step 2: Download new binary to temp file
    console.log('[ytdlp] Downloading new binary...')
    await downloadFile(downloadUrl, tempPath)
    
    // Verify download succeeded
    if (!existsSync(tempPath)) {
      return { success: false, message: 'Download failed - temp file not created.' }
    }
    
    const fs = await import('node:fs/promises')
    const stats = await fs.stat(tempPath)
    if (stats.size < 1000000) { // yt-dlp.exe should be at least 1MB
      await fs.unlink(tempPath).catch(() => {})
      return { success: false, message: 'Download appears corrupted (file too small).' }
    }
    
    // Step 3: Delete old binary (if exists)
    console.log('[ytdlp] Replacing old binary...')
    if (existsSync(binaryPath)) {
      try {
        await unlink(binaryPath)
      } catch (err) {
        // Try to rename old file instead
        try {
          await fs.rename(binaryPath, binaryPath + '.old')
        } catch {
          await fs.unlink(tempPath).catch(() => {})
          return { success: false, message: 'Failed to remove old binary. Make sure no downloads are active.' }
        }
      }
    }
    
    // Step 4: Rename temp to final
    await fs.rename(tempPath, binaryPath)
    
    // Step 5: Set executable permissions (for non-Windows)
    try {
      chmodSync(binaryPath, 0o755)
    } catch { /* ignore on Windows */ }
    
    // Cleanup old backup if exists
    if (existsSync(binaryPath + '.old')) {
      await fs.unlink(binaryPath + '.old').catch(() => {})
    }
    
    console.log(`[ytdlp] Update successful! Version: ${latestVersion}`)
    return { success: true, message: `Updated successfully to ${latestVersion}!`, version: latestVersion }
    
  } catch (err) {
    console.error('[ytdlp] Update error:', err)
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
    const p = spawn(getBinaryPath('yt-dlp'), args, { windowsHide: true, detached: false })
    
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

function getJsRuntimeArgs(): string[] {
  const denoPath = getBinaryPath('deno')
  if (existsSync(denoPath)) {
    return ['--js-runtimes', `deno:${denoPath}`]
  }
  const nodePath = getBinaryPath('node')
  if (existsSync(nodePath)) {
    return ['--js-runtimes', `node:${nodePath}`]
  }
  // Fallback: try to use system node
  return ['--js-runtimes', 'node']
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
    const isYT = isYouTubeUrl(url)

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
      '--no-cache-dir',
      // YouTube-specific: use lightweight Android client & skip heavy webpage/JS parsing
      '--extractor-args', isYT
        ? 'youtube:player_client=android,player_skip=webpage'
        : 'youtube:player_client=android',
      // Stealth/Bypass Arguments
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    ]

    const jsRuntimeArgs = getJsRuntimeArgs()
    args.push(...jsRuntimeArgs)

    // Cookie Logic: Prioritize manual cookie file in root, then passed cookieFile, then browser
    const globalCookies = getCookiesPath()
    if (globalCookies) {
      console.log(`[ytdlp Analysis] Using global cookies from: ${globalCookies}`)
      args.push('--cookies', globalCookies)
    } else if (cookieFile) {
      args.push('--cookies', cookieFile)
    } else if (browser && browser !== 'none') {
      args.push('--cookies-from-browser', browser)
    }

    args.push(url)

    const startMs = Date.now()
    console.log(`[ytdlp] Spawning analysis for: ${url.slice(0, 80)}...`)

    const p = spawn(ytdlpPath, args, { windowsHide: true, detached: false })

    let stdout = ''
    let stderr = ''

    p.stdout.on('data', (data) => (stdout += data.toString()))
    p.stderr.on('data', (data) => (stderr += data.toString()))

    // Handle spawn errors (e.g., ENOENT if binary is corrupted/missing at runtime)
    p.on('error', (err) => {
      reject(new Error(`فشل تشغيل yt-dlp: ${err.message}`))
    })

    p.on('close', (code) => {
      const elapsedMs = Date.now() - startMs
      console.log(`[ytdlp] Analysis finished in ${elapsedMs}ms (exit ${code})`)

      if (code !== 0) {
        console.error('yt-dlp analysis failed:', stderr)
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
        
        // Handle Playlist
        if (info._type === 'playlist') {
          const items = (info.entries || []).map((entry: any) => ({
              id: entry.id,
              title: entry.title || 'Unknown Title',
              url: entry.url || entry.webpage_url,
              thumbnail: entry.thumbnail ? String(entry.thumbnail) : (entry.thumbnails?.[0]?.url ? String(entry.thumbnails[0].url) : undefined)
          }))
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
          .filter((f: any) => (f.vcodec !== 'none' || f.acodec !== 'none') && f.protocol !== 'm3u8_native')
          .map((f: any) => ({
            formatId: f.format_id,
            ext: f.ext,
            resolution: f.resolution || (f.vcodec !== 'none' ? `${f.width}x${f.height}` : 'audio only'),
            filesize: f.filesize || f.filesize_approx || null,
            description: `${f.format_note || ''} ${f.fps ? f.fps + 'fps' : ''} ${f.tbr ? Math.round(f.tbr) + 'kbps' : ''} ${f.vcodec !== 'none' && f.acodec !== 'none' ? '(Muxed)' : ''}`.trim(),
            tbr: f.tbr || 0,
            height: f.height || 0
          }))
          // Sort by height descending, then by bitrate (tbr) descending
          .sort((a: any, b: any) => b.height - a.height || b.tbr - a.tbr)

        const result: AnalyzeResult = {
          kind: 'ytdlp',
          title: info.title || 'Unknown Title',
          thumbnail: info.thumbnail ? String(info.thumbnail) : (info.thumbnails?.[0]?.url ? String(info.thumbnails[0].url) : undefined),
          formats,
        }
        setCachedAnalysis(url, result)
        resolve(result)
      } catch (err) {
        console.error('Failed to parse yt-dlp output:', err)
        resolve({ kind: 'unknown' })
      }
    })
  })
}
