import { useEffect, useState } from 'react'

export interface MediaEndpoint {
  port: number
  token: string
}

let cachedEndpoint: MediaEndpoint | null = null

let inflightRequest: Promise<MediaEndpoint | null> | null = null

export function peekMediaEndpoint(): MediaEndpoint | null {
  return cachedEndpoint
}

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

      inflightRequest = null
      return null
    })

  return inflightRequest
}

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
