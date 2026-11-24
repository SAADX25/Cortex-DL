// Keeps a separate adaptive audio track synced to the visual trimmer's video element.
import { seekPreview } from './trimPreview'

export function isAbortPlaybackError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError')
}

export function syncTrimAudio(video: HTMLVideoElement | null, audio: HTMLAudioElement | null, play = false): Promise<void> {
  if (!video || !audio || !audio.getAttribute('src')) return Promise.resolve()
  audio.volume = video.volume
  audio.muted = video.muted
  audio.playbackRate = video.playbackRate

  const drift = Math.abs(audio.currentTime - video.currentTime)
  const audioSeeking = Boolean(audio.seeking)
  const shouldPlay = play && !video.paused && !video.seeking && video.readyState >= 3

  if (!shouldPlay) {
    if (audio.paused !== true) audio.pause()
    // Pre-position audio while paused/seeking without interrupting an in-flight audio seek.
    if (!audioSeeking && drift > 0.2) seekPreview(audio, video.currentTime)
    return Promise.resolve()
  }

  // Never re-seek an in-flight audio range fetch every timeupdate (~250ms), or remote streams thrash endlessly.
  const audioPlaying = audio.paused === false
  const driftThreshold = audioPlaying ? 0.35 : 0.15
  if ((!audioSeeking && drift > driftThreshold) || (audioSeeking && drift > 2.5)) {
    seekPreview(audio, video.currentTime)
  }

  if (audioPlaying) return Promise.resolve()

  return audio.play().catch((error: unknown) => {
    if (isAbortPlaybackError(error)) return
    throw error
  })
}

export function applyTrimAudioControls(
  video: HTMLVideoElement | null,
  audio: HTMLAudioElement | null,
  volume: number,
  muted: boolean,
  playbackRate: number,
): void {
  const safeVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
  const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1
  if (video) {
    video.volume = safeVolume
    video.muted = muted
    video.playbackRate = safeRate
  }
  if (audio) {
    audio.volume = safeVolume
    audio.muted = muted
    audio.playbackRate = safeRate
  }
}
