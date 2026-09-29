const sessions = new Set<string>()
let audioContexts = 0

export function markMediaSession(session: string, active: boolean): void {
  if (active) sessions.add(session)
  else sessions.delete(session)
}

export function markAudioContext(opened: boolean): void {
  audioContexts = Math.max(0, audioContexts + (opened ? 1 : -1))
}

/** Call from the developer console; packaged builds require the diagnostics env flag. */
if (typeof window !== 'undefined') {
  window.__cortexMediaDiagnostics = async () => {
    const main = await window.cortexDl.getMediaDiagnostics()
    if (!main) return null
    return { main, renderer: { sessions: sessions.size, audioContexts } }
  }
}
