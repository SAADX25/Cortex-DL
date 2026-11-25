// Transport bar for Visual Trim Studio: play/pause, skip, loop, audio controls, playback speed, and fullscreen
import React from 'react'
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { formatCompactTime } from './trimTime'
import type { Translations } from '../../locales/types'

const PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const

export interface TrimmerControlsProps {
  tr: Translations['trimmer']
  streamUrl: string | null
  streamError: string | null
  effectiveIsLive: boolean
  isPlaying: boolean
  loopSelection: boolean
  effectiveVolume: number
  currentTime: number
  safeDuration: number
  playbackRate: number
  isFullscreen: boolean
  onTogglePlay: () => void
  onSeekVideo: (seconds: number) => void
  onToggleLoop: () => void
  onToggleMute: () => void
  onVolumeChange: (volume: number) => void
  onRateChange: (rate: number) => void
  onToggleFullscreen: () => void
}

export const TrimmerControls: React.FC<TrimmerControlsProps> = ({
  tr,
  streamUrl,
  streamError,
  effectiveIsLive,
  isPlaying,
  loopSelection,
  effectiveVolume,
  currentTime,
  safeDuration,
  playbackRate,
  isFullscreen,
  onTogglePlay,
  onSeekVideo,
  onToggleLoop,
  onToggleMute,
  onVolumeChange,
  onRateChange,
  onToggleFullscreen,
}) => {
  const VolumeIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2

  return (
    <div className="advanced-trimmer__controls" dir="ltr">
      <div className="advanced-trimmer__controls-left">
        <button
          type="button"
          className="advanced-trimmer__icon-btn advanced-trimmer__icon-btn--primary"
          onClick={onTogglePlay}
          disabled={!streamUrl || Boolean(streamError)}
          aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
          title={isPlaying ? tr.pauseSpace : tr.playSpace}
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </button>

        {!effectiveIsLive && (
          <>
            <button
              type="button"
              className="advanced-trimmer__icon-btn"
              onClick={() => onSeekVideo(currentTime - 10)}
              aria-label="Back 10 seconds"
              title={tr.back10s}
            >
              <SkipBack size={14} />
              <span>10</span>
            </button>
            <button
              type="button"
              className="advanced-trimmer__icon-btn"
              onClick={() => onSeekVideo(currentTime + 10)}
              aria-label="Forward 10 seconds"
              title={tr.forward10s}
            >
              <SkipForward size={14} />
              <span>10</span>
            </button>
            <button
              type="button"
              className={`advanced-trimmer__icon-btn${loopSelection ? ' is-active' : ''}`}
              onClick={onToggleLoop}
              aria-label="Loop trimmed clip"
              aria-pressed={loopSelection}
              title={tr.loopSelection}
            >
              <Repeat size={14} />
            </button>
          </>
        )}

        <div className="advanced-trimmer__audio-controls">
          <button
            type="button"
            className="advanced-trimmer__icon-btn"
            onClick={onToggleMute}
            aria-label={effectiveVolume === 0 ? 'Unmute preview' : 'Mute preview'}
            title={effectiveVolume === 0 ? tr.unmuteM : tr.muteM}
          >
            <VolumeIcon size={15} />
          </button>
          <input
            type="range"
            className="advanced-trimmer__volume-slider"
            min={0}
            max={1}
            step={0.01}
            value={effectiveVolume}
            aria-label="Preview volume"
            onChange={event => onVolumeChange(Number(event.currentTarget.value))}
          />
          <span className="advanced-trimmer__volume-pct">{Math.round(effectiveVolume * 100)}%</span>
        </div>
      </div>

      <div className="advanced-trimmer__controls-right">
        <span className="advanced-trimmer__clock">
          {effectiveIsLive
            ? tr.liveStream
            : `${formatCompactTime(currentTime)} / ${formatCompactTime(safeDuration)}`}
        </span>

        {!effectiveIsLive && (
          <div className="advanced-trimmer__rate-group" role="group" aria-label="Playback speed">
            {PLAYBACK_RATES.map(rate => (
              <button
                key={rate}
                type="button"
                className={`advanced-trimmer__rate-btn${playbackRate === rate ? ' is-active' : ''}`}
                onClick={() => onRateChange(rate)}
              >
                {rate}x
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="advanced-trimmer__icon-btn"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}
          title={isFullscreen ? tr.exitFullscreen : tr.fullscreen}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  )
}
