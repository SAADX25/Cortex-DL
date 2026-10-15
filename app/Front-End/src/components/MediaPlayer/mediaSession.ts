
export function releaseMediaElement(element: HTMLMediaElement | null): void {
  if (!element) return
  element.pause()
  element.currentTime = 0

  element.removeAttribute('src')
  for (const source of element.querySelectorAll('source, track')) {
    source.removeAttribute('src')
  }
  element.load()
}

export function clearMediaCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)

  canvas.width = 0
  canvas.height = 0
}

export async function releaseAudioGraph(
  context: AudioContext,
  source: MediaElementAudioSourceNode,
  analyser: AnalyserNode,
): Promise<void> {
  source.disconnect(analyser)
  analyser.disconnect()
  await context.close().catch(() => {})
}

export function stopPlayerFrame(id: number | null, cancel = cancelAnimationFrame): void {
  if (id !== null) cancel(id)
}
