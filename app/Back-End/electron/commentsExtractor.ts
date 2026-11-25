// Extracts video comments via yt-dlp --write-comments and saves a readable text report.
import { ensureEnginesReady, engineExecutionFailed } from './engines/engineManager'
import { spawn } from 'node:child_process'
import { promises as fsPromises } from 'node:fs'
import log from 'electron-log'
import { getBinaryPath } from './paths'
import { checkJsRuntime, getJsRuntimeArgs } from './engines/ytdlpService'
import { killProcessTree } from './utils'

const MAX_COMMENTS_STDOUT_BYTES = 50 * 1024 * 1024
const COMMENTS_TIMEOUT_MS = 5 * 60 * 1000

export async function extractAndSaveComments(
  url: string,
  outputPath: string,
  onProgress?: (current: number, total: number) => void,
): Promise<boolean> {
  await ensureEnginesReady(['yt-dlp', 'deno'])
  await checkJsRuntime()
  return new Promise<boolean>(resolve => {
    log.info(`[CommentsExtractor] Starting comment extraction for ${url}`)
    const ytDlpPath = getBinaryPath('yt-dlp')

    const args = [
      '--dump-json',
      '--write-comments',
      '--skip-download',
      '--no-playlist',
      '--ignore-config',
      ...getJsRuntimeArgs(),
      '--',
      url,
    ]

    const proc = spawn(ytDlpPath, args, {
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })

    let settled = false
    let aborted = false
    let stdoutBytes = 0
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(ok)
    }

    const abortExtraction = (reason: string) => {
      if (aborted) return
      aborted = true
      log.warn(`[CommentsExtractor] Aborting extraction: ${reason}`)
      void killProcessTree(proc)
    }

    const timeout = setTimeout(() => {
      abortExtraction(`timed out after ${COMMENTS_TIMEOUT_MS}ms`)
    }, COMMENTS_TIMEOUT_MS)
    timeout.unref?.()

    const safeProgress = (current: number, total: number) => {
      if (!onProgress || settled || aborted) return
      try {
        onProgress(current, total)
      } catch (err) {
        log.warn('[CommentsExtractor] Progress callback threw:', err)
      }
    }

    const stdoutChunks: Buffer[] = []

    proc.stdout.on('data', chunk => {
      if (aborted) return
      const buf = Buffer.from(chunk)
      stdoutBytes += buf.length
      if (stdoutBytes > MAX_COMMENTS_STDOUT_BYTES) {
        abortExtraction(`output exceeded ${MAX_COMMENTS_STDOUT_BYTES} bytes`)
        return
      }
      stdoutChunks.push(buf)
    })

    proc.stderr.on('data', chunk => {
      if (aborted) return
      const text = chunk.toString()

      // Guard against yt-dlp ignoring --skip-download and starting an actual media download.
      if (text.includes('Downloading 1 format(s)') || text.includes('[download] Destination:')) {
        abortExtraction('unexpected media download started')
        return
      }

      // Bail out immediately instead of letting yt-dlp stall without a JS runtime.
      if (text.includes('No supported JavaScript runtime could be found')) {
        abortExtraction('no supported JS runtime found')
        return
      }

      if (onProgress) {
        const finalMatch = text.match(/Extracted\s+(\d+)\s+comments/i)
        if (finalMatch && finalMatch[1]) {
          const finalCount = parseInt(finalMatch[1], 10)
          if (!isNaN(finalCount)) {
            safeProgress(finalCount, finalCount)
          }
        } else {
          const match = text.match(/\((\d+)\/~?(\d+)\)/)

          if (match && match[1] && match[2]) {
            const current = parseInt(match[1], 10)
            const total = parseInt(match[2], 10)
            if (!isNaN(current) && !isNaN(total)) {
              safeProgress(current, total)
            }
          }
        }
      }
    })

    proc.on('close', async code => {
      clearTimeout(timeout)
      if (aborted || code !== 0) {
        log.warn(`[CommentsExtractor] Extraction exited with code ${code} (aborted=${aborted}).`)
        finish(false)
        return
      }
      try {
        const stdoutData = Buffer.concat(stdoutChunks).toString('utf-8')
        if (!stdoutData.trim()) {
          log.warn(`[CommentsExtractor] No output from yt-dlp. Process exited with code ${code}.`)
          finish(false)
          return
        }

        const info = JSON.parse(stdoutData)
        if (!info.comments || !Array.isArray(info.comments) || info.comments.length === 0) {
          log.warn(`[CommentsExtractor] No comments found in JSON for ${url}`)
          await fsPromises.writeFile(outputPath, 'No comments found.', 'utf-8')
          finish(true)
          return
        }

        log.info(`[CommentsExtractor] Found ${info.comments.length} comments. Formatting...`)

        const formattedComments = info.comments
          .map((c: any) => {
            const author = c.author || 'Unknown'
            const text = c.text || ''
            const likes = c.like_count ? `(👍 ${c.like_count})` : ''
            const date = c.time_text || ''

            return `👤 ${author} ${likes} ${date}\n📝 ${text}`
          })
          .join('\n\n---------------------------------------\n\n')

        const header =
          `📋 Comments for: ${info.title || url}\n` +
          `🌐 URL: ${url}\n` +
          `💬 Total Extracted: ${info.comments.length}\n` +
          `---------------------------------------\n\n`

        await fsPromises.writeFile(outputPath, header + formattedComments, 'utf-8')
        log.info(`[CommentsExtractor] Comments successfully written to ${outputPath}`)
        finish(true)
      } catch (err) {
        log.error(`[CommentsExtractor] Failed to parse JSON or write file:`, err)
        finish(false)
      }
    })

    proc.on('error', err => {
      engineExecutionFailed('yt-dlp', err)
      log.error(`[CommentsExtractor] Spawn error:`, err)
      finish(false)
    })
  })
}
