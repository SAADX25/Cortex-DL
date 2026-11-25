// Session webRequest hooks for Kick HLS Referer headers and CORS overrides on whitelisted media CDNs
import type { Session } from 'electron'

const MEDIA_CORS_WHITELIST = [
  /(^|\.)googlevideo\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)ytimg\.com$/i,
  /(^|\.)fbcdn\.net$/i,
  /(^|\.)cdninstagram\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)twimg\.com$/i,
  /(^|\.)akamaihd\.net$/i,
  /(^|\.)akamaized\.net$/i,
  /(^|\.)tiktokcdn\.com$/i,
  /(^|\.)vimeocdn\.com$/i,
  /(^|\.)live-video\.net$/i,
  /(^|\.)kick\.com$/i,
  /(^|\.)cloudfront\.net$/i,
  /(^|\.)ttvnw\.net$/i,
]

const KICK_MEDIA_HOSTS = [/(^|\.)live-video\.net$/i, /^stream\.kick\.com$/i]

export function installMediaSessionHeaders(targetSession: Session): void {
  // Kick HLS CDNs reject playback without kick.com Referer/Origin headers.
  targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      if (details.url.startsWith('http')) {
        const { hostname } = new URL(details.url)
        if (KICK_MEDIA_HOSTS.some(re => re.test(hostname))) {
          const headers = { ...details.requestHeaders }
          headers['Referer'] = 'https://kick.com/'
          headers['Origin'] = 'https://kick.com'
          return callback({ requestHeaders: headers })
        }
      }
    } catch {
      // Keep original headers on malformed URLs.
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  // Rewrite CORS headers for whitelisted media CDNs so renderer previews and HLS.js can load streams.
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      const rawUrl = details.url
      if (!rawUrl.startsWith('http')) return callback({ responseHeaders: details.responseHeaders })
      const { hostname } = new URL(rawUrl)
      const allowed = MEDIA_CORS_WHITELIST.some(re => re.test(hostname))
      if (allowed) {
        const headers: Record<string, string[]> = {}
        for (const [key, value] of Object.entries(details.responseHeaders ?? {})) {
          if (key.toLowerCase() === 'access-control-allow-origin') continue
          headers[key] = value
        }
        headers['Access-Control-Allow-Origin'] = ['*']
        callback({ responseHeaders: headers })
      } else {
        callback({ responseHeaders: details.responseHeaders })
      }
    } catch {
      callback({ responseHeaders: details.responseHeaders })
    }
  })
}
