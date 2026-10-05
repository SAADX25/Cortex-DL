/** Owns the disk streams and subtitle processes opened by player sessions. */
export class MediaRequestRegistry {
  private readonly active = new Map<() => void, { session: string | null; kind: 'stream' | 'subtitle' | 'probe' }>()
  private readonly closedSessions = new Set<string>()
  private readonly idleWaiters = new Set<{ session: string | null; resolve: () => void }>()
  private stopping = false

  isClosed(session: string | null): boolean {
    return this.stopping || (session !== null && this.closedSessions.has(session))
  }

  track(session: string | null, kind: 'stream' | 'subtitle' | 'probe', stop: () => void): () => void {
    if (this.isClosed(session)) {
      stop()
      return () => {}
    }
    this.active.set(stop, { session, kind })
    return () => {
      this.active.delete(stop)
      this.notifyIdle()
    }
  }

  closeSession(session: string): Promise<void> {
    if (!session || !/^[a-zA-Z0-9-]{1,80}$/.test(session)) return Promise.resolve()
    this.closedSessions.add(session)
    // Bound tombstones while still rejecting requests that arrive just after close.
    if (this.closedSessions.size > 512) this.closedSessions.delete(this.closedSessions.values().next().value!)
    for (const [stop, entry] of this.active) {
      if (entry.session === session) {
        stop()
      }
    }
    return this.waitForIdle(session)
  }

  closeAll(): Promise<void> {
    this.stopping = true
    for (const stop of this.active.keys()) stop()
    return this.waitForIdle(null)
  }

  private hasActive(session: string | null): boolean {
    return [...this.active.values()].some(entry => session === null || entry.session === session)
  }

  private waitForIdle(session: string | null): Promise<void> {
    if (!this.hasActive(session)) return Promise.resolve()
    return new Promise(resolve => { this.idleWaiters.add({ session, resolve }) })
  }

  private notifyIdle(): void {
    for (const waiter of this.idleWaiters) {
      if (!this.hasActive(waiter.session)) {
        this.idleWaiters.delete(waiter)
        waiter.resolve()
      }
    }
  }

  snapshot(): { streams: number; ffmpegProcesses: number; probeProcesses: number; sessions: number } {
    const entries = [...this.active.values()]
    return {
      streams: entries.filter(entry => entry.kind === 'stream').length,
      ffmpegProcesses: entries.filter(entry => entry.kind === 'subtitle').length,
      probeProcesses: entries.filter(entry => entry.kind === 'probe').length,
      sessions: new Set(entries.map(entry => entry.session).filter(Boolean)).size,
    }
  }
}
