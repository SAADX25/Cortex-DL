/** All asynchronous UI writes must retain the currently owned generation. */
export class AnalysisSession {
  private generation = 0
  private dispose?: () => void
  private start = 0
  begin(dispose?: () => void): number {
    this.cancel()
    this.dispose = dispose
    this.start = performance.now()
    return this.generation
  }
  current(id: number): boolean { return id === this.generation }
  elapsed(): number { return Math.round(performance.now() - this.start) }
  cancel(): void { this.generation++; this.dispose?.(); this.dispose = undefined }
}

export const primaryAnalysis = new AnalysisSession()
