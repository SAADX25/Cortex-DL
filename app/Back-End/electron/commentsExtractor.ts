import { spawn } from 'node:child_process'
import { promises as fsPromises } from 'node:fs'
import log from 'electron-log'
import { getBinaryPath } from './paths'
import { getJsRuntimeArgs } from './ytdlp'

export async function extractAndSaveComments(url: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    log.info(`[CommentsExtractor] Starting comment extraction for ${url}`)
    const ytDlpPath = getBinaryPath('yt-dlp')

    // Use yt-dlp to quickly get JSON which includes the comments
    const args = [
      '--dump-json',
      '--write-comments',
      '--playlist-items', '0',
      '--no-warnings',
      ...getJsRuntimeArgs(),
      url
    ]

    const proc = spawn(ytDlpPath, args, { windowsHide: true })
    
    let stdoutData = ''
    let stderrData = ''

    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString()
    })

    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString()
    })

    proc.on('close', async (code) => {
      if (code !== 0) {
        log.error(`[CommentsExtractor] Process exited with code ${code}. Stderr: ${stderrData}`)
        resolve(false)
        return
      }

      try {
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
