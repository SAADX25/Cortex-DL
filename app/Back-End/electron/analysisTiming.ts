import log from 'electron-log'

export function analysisTiming(name: string, start: number): void {
  if (process.env.CORTEX_ANALYSIS_DEBUG === '1') log.info(`[analysis timing] ${name}=${Date.now() - start}ms`)
}
