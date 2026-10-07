import { seekPreview } from './trimPreview'

/** Keep an adaptive audio resource on the video's clock, including native controls. */
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
