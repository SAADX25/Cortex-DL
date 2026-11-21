import { seekPreview } from './trimPreview'

export function syncTrimAudio(video: HTMLVideoElement | null, audio: HTMLAudioElement | null, play = false): Promise<void> {
  if (!video || !audio || !audio.getAttribute('src')) return Promise.resolve()
  audio.volume = video.volume
  audio.muted = video.muted
  audio.playbackRate = video.playbackRate
  if (Math.abs(audio.currentTime - video.currentTime) > 0.2) seekPreview(audio, video.currentTime)
  if (play && !video.paused && !video.seeking && video.readyState >= 3) return audio.play()
  if (video.paused || video.seeking || !play) audio.pause()
  return Promise.resolve()
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
