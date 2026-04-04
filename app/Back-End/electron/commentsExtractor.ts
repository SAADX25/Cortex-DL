import { spawn } from 'node:child_process'
import { promises as fsPromises } from 'node:fs'
import log from 'electron-log'
import { getBinaryPath } from './paths'
import { getJsRuntimeArgs } from './ytdlp'

export async function extractAndSaveComments(url: string, outputPath: string, onProgress?: (current: number, total: number) => void): Promise<boolean> {
  return new Promise((resolve, _reject) => {
    log.info(`[CommentsExtractor] Starting comment extraction for ${url}`)
    const ytDlpPath = getBinaryPath('yt-dlp')

    // Use yt-dlp to quickly get JSON which includes the comments
    const args = [
      '--dump-json',
      '--write-comments',
      '--skip-download',
      '--playlist-items', '0',
      '--verbose',
      ...getJsRuntimeArgs(),
      url
    ]

    const proc = spawn(ytDlpPath, args, { windowsHide: true })
    
    const stdoutChunks: Buffer[] = []
    let stderrData = ''

    proc.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.from(chunk))
    })

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderrData += text
      console.log('[YTDLP RAW]:', text.trim())

      // The Ultimate Failsafe: aggressively kill if yt-dlp attempts to download the video anyway
      if (text.includes('Downloading 1 format(s)') || text.includes('[download] Destination:')) {
        proc.kill()
        // The close event will automatically trigger and process the stdout chunks buffer.
        return
      }
      
      // Smart Error Handling (Fail-Fast)
      if (text.includes('No supported JavaScript runtime could be found')) {
        proc.kill()
        // Do not reject here. The close event will handle it naturally when process exits
        return
      }

      // Real-Time Progress Counter via Callback
      if (onProgress) {
        // Catch the final count: "Extracted 1849 comments"
        const finalMatch = text.match(/Extracted\s+(\d+)\s+comments/i)
        if (finalMatch && finalMatch[1]) {
          const finalCount = parseInt(finalMatch[1], 10)
          if (!isNaN(finalCount)) {
            onProgress(finalCount, finalCount)
          }
        } else {
          // Track API Batches instead of exact numbers by parsing pagination requests in verbose logs
          // Extract the true progress output, e.g., "Downloading comment API JSON page 47 (1011/~1863)"
          const match = text.match(/\((\d+)\/\~?(\d+)\)/)
          
          if (match && match[1] && match[2]) {
            const current = parseInt(match[1], 10)
            const total = parseInt(match[2], 10)
            if (!isNaN(current) && !isNaN(total)) {
              onProgress(current, total)
            }
          }
        }
      }
    })

    proc.on('close', async (code) => {
      // Do NOT exit early if killed or if code !== 0, because yt-dlp often returns code 1 if there are minor warnings, 
      // or if we killed it intentionally via our failsafe.
      // But we might still have perfectly valid JSON output in stdoutChunks!

      try {
        const stdoutData = Buffer.concat(stdoutChunks).toString('utf-8')
        if (!stdoutData.trim()) {
          log.warn(`[CommentsExtractor] No output from yt-dlp. Process exited with code ${code}.`)
          resolve(false)
          return
        }

        const info = JSON.parse(stdoutData)
        if (!info.comments || !Array.isArray(info.comments) || info.comments.length === 0) {
          log.warn(`[CommentsExtractor] No comments found in JSON for ${url}`)
          await fsPromises.writeFile(outputPath, "No comments found.", 'utf-8')
          resolve(true)
          return
        }

        log.info(`[CommentsExtractor] Found ${info.comments.length} comments. Formatting...`)

        const formattedComments = info.comments.map((c: any) => {
          const author = c.author || 'Unknown'
          const text = c.text || ''
          const likes = c.like_count ? `(👍 ${c.like_count})` : ''
          const date = c.time_text || '' // Like "2 months ago"
          
          return `👤 ${author} ${likes} ${date}\n📝 ${text}`
        }).join('\n\n---------------------------------------\n\n')

        const header = `📋 Comments for: ${info.title || url}\n` +
                       `🌐 URL: ${url}\n` +
                       `💬 Total Extracted: ${info.comments.length}\n` +
                       `---------------------------------------\n\n`

        await fsPromises.writeFile(outputPath, header + formattedComments, 'utf-8')
        log.info(`[CommentsExtractor] Comments successfully written to ${outputPath}`)
        resolve(true)
      } catch (err) {
        log.error(`[CommentsExtractor] Failed to parse JSON or write file:`, err)
        resolve(false)
      }
    })

    proc.on('error', (err) => {
      log.error(`[CommentsExtractor] Spawn error:`, err)
      resolve(false)
    })
  })
}
