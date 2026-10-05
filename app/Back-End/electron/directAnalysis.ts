/** HEAD is advisory: providers that disallow it still get their normal extractor. */
export async function isDirectMedia(url: string, signal: AbortSignal): Promise<boolean> {
  if (!/\.(?:mp4|webm|mkv|mov|mp3|m4a|wav|flac|ogg|opus)(?:[?#]|$)/i.test(url)) return false
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal })
    return response.ok && /^(?:video|audio)\//i.test(response.headers.get('content-type') ?? '')
  } catch {
    signal.throwIfAborted()
    return false
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
