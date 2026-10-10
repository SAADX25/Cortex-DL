import { performance } from 'node:perf_hooks'
export const startupTimings: Record<string, number> = {}
export const startupWallTimes: Record<string, number> = { processStartedAt: Math.round(Date.now() - process.uptime() * 1000) }
export function startupMark(name: string): void {
  startupTimings[name] = Math.round(process.uptime() * 1000)
  startupWallTimes[name] = Date.now()
}
export function startupDuration(name: string, start: number): void { startupTimings[name] = Math.round((performance.now() - start) * 100) / 100 }
