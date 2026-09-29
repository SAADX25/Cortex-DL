/** Releases the browser's media resource and cancels its pending network load. */
export function releaseMediaElement(element: HTMLMediaElement | null): void {
  if (!element) return
  try { element.pause() } catch { /* The element may already be detached. */ }
  try { element.currentTime = 0 } catch { /* Seeking may be unavailable. */ }
  element.removeAttribute('src')
  for (const source of element.querySelectorAll('source, track')) {
    source.removeAttribute('src')
  }
  try { element.load() } catch { /* A detached element may reject a reload. */ }
}

export function clearMediaCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  // Resetting dimensions releases the old backing store, including 4K frames.
  canvas.width = 0
  canvas.height = 0
}

export async function releaseAudioGraph(
  context: AudioContext,
  source: MediaElementAudioSourceNode,
  analyser: AnalyserNode,
): Promise<void> {
  try { source.disconnect(analyser) } catch { /* Already disconnected. */ }
  try { analyser.disconnect() } catch { /* Already disconnected. */ }
  await context.close().catch(() => {})
}

export function stopPlayerFrame(id: number | null, cancel = cancelAnimationFrame): void {
  if (id !== null) cancel(id)
}
