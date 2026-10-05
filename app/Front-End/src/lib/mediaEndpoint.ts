/**
 * Access layer for the local media-streaming server.
 *
 * The server is protected by a per-launch capability token, so a bare
 * `http://127.0.0.1:<port>/?path=...` URL is no longer sufficient — every
 * request must also carry `token`. The endpoint is fetched once over IPC and
 * memoised for the lifetime of the renderer.
 */
import { useEffect, useState } from 'react'

export interface MediaEndpoint {
  port: number
  token: string
}

let cachedEndpoint: MediaEndpoint | null = null
let inflightRequest: Promise<MediaEndpoint | null> | null = null

/** Already-resolved endpoint, or null if it has not been fetched yet. */
export function peekMediaEndpoint(): MediaEndpoint | null {
  return cachedEndpoint
}

/**
 * Resolves (and caches) the media endpoint. Returns null when the bridge is
 * unavailable or the main process failed to answer, so callers can degrade
 * gracefully instead of rendering a URL that would be rejected with 401.
 */
export function loadMediaEndpoint(): Promise<MediaEndpoint | null> {
  if (cachedEndpoint) return Promise.resolve(cachedEndpoint)
  if (inflightRequest) return inflightRequest

  const bridge = window.cortexDl?.getMediaEndpoint
  if (!bridge) return Promise.resolve(null)

  inflightRequest = window.cortexDl
    .getMediaEndpoint()
    .then((endpoint) => {
      if (!endpoint?.token || !endpoint.port) {
        throw new Error('media endpoint response was incomplete')
      }
      cachedEndpoint = { port: endpoint.port, token: endpoint.token }
      return cachedEndpoint
    })
    .catch((err) => {
      console.error('Failed to resolve the local media endpoint', err)
      // Allow a later attempt to retry rather than caching the failure forever.
      inflightRequest = null
      return null
    })

  return inflightRequest
}

/**
 * Builds an authorised media-server URL for `filePath`.
 * Returns an empty string when the endpoint is not resolved yet, which the
 * media elements treat as "nothing to load".
 */
export function buildMediaUrl(
  filePath: string | null | undefined,
  endpoint: MediaEndpoint | null,
  extraParams?: Record<string, string | number | undefined>,
): string {
  if (!filePath || !endpoint) return ''

  const url = new URL(`http://127.0.0.1:${endpoint.port}/`)
  url.searchParams.set('path', filePath)
  url.searchParams.set('token', endpoint.token)

  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

/** Subscribes a component to the resolved media endpoint. */
export function useMediaEndpoint(): MediaEndpoint | null {
  const [endpoint, setEndpoint] = useState<MediaEndpoint | null>(() => cachedEndpoint)

  useEffect(() => {
    if (endpoint) return

    let cancelled = false
    loadMediaEndpoint().then((resolved) => {
      if (!cancelled && resolved) setEndpoint(resolved)
    })

    return () => {
      cancelled = true
    }
  }, [endpoint])

  return endpoint
}
