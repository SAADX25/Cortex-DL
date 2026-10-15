import { probeMediaFile } from '../services/mediaService'
import { videoFrameRate } from '../../../Shared/frameRate'

export class MediaProcessor {
  private readonly activeProbes = new Set<AbortController>()

  killAll(): void {
    for (const controller of this.activeProbes) controller.abort()
  }

  async getFps(filePath: string): Promise<number | null> {
    const controller = new AbortController()
    this.activeProbes.add(controller)
    try {
      const probe = await probeMediaFile(filePath, undefined, controller.signal)
      return videoFrameRate(probe.streams ?? [])
    } finally {
      this.activeProbes.delete(controller)
    }
  }
}
