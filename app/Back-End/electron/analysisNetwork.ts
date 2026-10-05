/** Deadline includes response body consumption; optional callers can silently degrade. */
export async function fetchBoundedJson(url: string, signal?: AbortSignal, timeoutMs = 3000): Promise<any> {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`) }
    if (!response.body) throw new Error('Empty response')
    const reader = response.body.getReader()
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 2 * 1024 * 1024) throw new Error('JSON response exceeds size limit')
        chunks.push(value)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
