import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Loader, RotateCcw, Scissors } from 'lucide-react'
import './AdvancedTrimmer.css'
import { TrimPreview, seekPreview, videoFailure } from './trimPreview'
import { releaseMediaElement } from './MediaPlayer/mediaSession'
import { syncTrimAudio } from './trimAudio'

export type TrimRange = {
  startSeconds: number
  endSeconds: number
  startTime: string
  endTime: string
}

type AdvancedTrimmerProps = {
  
  videoUrl: string
  
  originalUrl?: string
  duration: number
  initialStartTime?: string
  initialEndTime?: string
  onChange?: (range: TrimRange) => void
  onConfirm: (range: TrimRange) => void
}

const SLIDER_STEP_SECONDS = 0.1

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function parseTimeToSeconds(value?: string): number | null {
  if (!value?.trim()) return null
  const parts = value.trim().split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

function formatSeconds(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
  ].join(':')
}

function buildRange(startSeconds: number, endSeconds: number): TrimRange {
  return {
    startSeconds,
    endSeconds,
    startTime: formatSeconds(startSeconds),
    endTime: formatSeconds(endSeconds),
  }
}

const AdvancedTrimmer: React.FC<AdvancedTrimmerProps> = ({
  videoUrl,
  originalUrl,
  duration,
  initialStartTime,
  initialEndTime,
  onChange,
  onConfirm,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const [startSeconds, setStartSeconds] = useState(() => {
    const parsed = parseTimeToSeconds(initialStartTime)
    return parsed == null ? 0 : clamp(parsed, 0, safeDuration)
  })
  const [endSeconds, setEndSeconds] = useState(() => {
    const parsed = parseTimeToSeconds(initialEndTime)
    return parsed == null ? safeDuration : clamp(parsed, 0, safeDuration)
  })

  
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [isResolvingStream, setIsResolvingStream] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)

  const previewRef = useRef<TrimPreview | null>(null)
  const requestedSeek = useRef<number>(clamp(parseTimeToSeconds(initialStartTime) ?? 0, 0, safeDuration))

  useEffect(() => {
    const session = `trim-${crypto.randomUUID()}`
    const video = videoRef.current
    const audio = audioRef.current
    let disposed = false
    let extractedVideo = ''
    setAudioError(null)
    const preview = new TrimPreview(videoUrl, (source, error, loading) => {
      if (source !== extractedVideo) {
        releaseMediaElement(audio)
        setAudioUrl(null)
      }
      setStreamUrl(source)
      setStreamError(error)
      setIsResolvingStream(loading)
    })
    previewRef.current = preview
    void preview.start(originalUrl ? async () => {
      // The old bridge remains usable during a frontend-only development reload.
      if (!window.cortexDl.getTrimPreviewStreams) return window.cortexDl.getDirectStreamUrl(originalUrl, session)
      const streams = await window.cortexDl.getTrimPreviewStreams(originalUrl, session)
      if (!streams) throw new Error('Preview extraction cancelled')
      if (!disposed) {
        extractedVideo = streams.videoUrl
        setAudioUrl(streams.audioUrl ?? null)
      }
      return streams.videoUrl
    } : undefined)
    return () => {
      disposed = true
      preview.dispose()
      previewRef.current = null
      releaseMediaElement(video)
      releaseMediaElement(audio)
      void window.cortexDl.closeMediaSession(session).catch(error => console.error('[Visual Trim] Session cleanup failed:', error))
    }
  }, [videoUrl, originalUrl])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = muted
      audioRef.current.volume = volume
    }
  }, [muted, volume, audioUrl])

  function syncAudio(play = false): void {
    void syncTrimAudio(videoRef.current, audioRef.current, play).catch(() => {
      setAudioError('Preview audio could not play. Pause and play again, or reanalyze the source.')
    })
  }

  const currentRange = useMemo(
    () => buildRange(startSeconds, endSeconds),
    [endSeconds, startSeconds],
  )

  const sliderStyle = {
    '--trim-start': `${safeDuration ? (startSeconds / safeDuration) * 100 : 0}%`,
    '--trim-end': `${safeDuration ? (endSeconds / safeDuration) * 100 : 100}%`,
  } as React.CSSProperties & Record<'--trim-start' | '--trim-end', string>

  useEffect(() => {
    const parsedStart = parseTimeToSeconds(initialStartTime)
    const parsedEnd = parseTimeToSeconds(initialEndTime)
    const nextStart = parsedStart == null ? 0 : clamp(parsedStart, 0, safeDuration)
    const nextEnd = parsedEnd == null ? safeDuration : clamp(parsedEnd, nextStart, safeDuration)
    setStartSeconds(nextStart)
    setEndSeconds(nextEnd)
  }, [initialEndTime, initialStartTime, safeDuration])

  function seekVideo(seconds: number): void {
    requestedSeek.current = clamp(seconds, 0, safeDuration)
    seekPreview(videoRef.current, requestedSeek.current)
    seekPreview(audioRef.current, requestedSeek.current)
  }

  function emitChange(nextStart: number, nextEnd: number): void {
    onChange?.(buildRange(nextStart, nextEnd))
  }

  function handleStartChange(value: number): void {
    const nextStart = clamp(value, 0, Math.max(0, endSeconds - SLIDER_STEP_SECONDS))
    setStartSeconds(nextStart)
    seekVideo(nextStart)
    emitChange(nextStart, endSeconds)
  }

  function handleEndChange(value: number): void {
    const nextEnd = clamp(value, Math.min(safeDuration, startSeconds + SLIDER_STEP_SECONDS), safeDuration)
    setEndSeconds(nextEnd)
    seekVideo(nextEnd)
    emitChange(startSeconds, nextEnd)
  }

  function handleReset(): void {
    setStartSeconds(0)
    setEndSeconds(safeDuration)
    seekVideo(0)
    emitChange(0, safeDuration)
  }

  return (
    <div className="advanced-trimmer">
      <div className="advanced-trimmer__header">
        <div className="advanced-trimmer__title">
          <Scissors size={16} aria-hidden="true" />
          <span>Visual Trim</span>
        </div>
        <div className="advanced-trimmer__time-pair" aria-live="polite">
          <span>{currentRange.startTime}</span>
          <span>{currentRange.endTime}</span>
        </div>
      </div>

      <div className="advanced-trimmer__video-wrap">
        {isResolvingStream && (
          <div className="advanced-trimmer__loading-overlay">
            <Loader size={28} className="advanced-trimmer__spinner" aria-hidden="true" />
            <span>Extracting preview stream…</span>
          </div>
        )}
        {(streamError || audioError) && (
          <div className="advanced-trimmer__notice advanced-trimmer__notice--warn" role="status">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{streamError ? `Video preview unavailable — the trim range still works normally. ${streamError}` : audioError}</span>
          </div>
        )}
        <video
          ref={videoRef}
          className={`advanced-trimmer__video${streamError || isResolvingStream ? ' advanced-trimmer__video--hidden' : ''}`}
          src={streamUrl ?? undefined}
          controls
          muted={muted}
          preload="metadata"
          onPlay={() => syncAudio(true)}
          onPlaying={() => syncAudio(true)}
          onPause={() => syncAudio()}
          onEnded={() => syncAudio()}
          onWaiting={() => syncAudio()}
          onSeeking={() => syncAudio()}
          onSeeked={() => syncAudio(true)}
          onRateChange={() => syncAudio(!videoRef.current?.paused)}
          onTimeUpdate={() => syncAudio(!videoRef.current?.paused)}
          onVolumeChange={(event) => {
            setMuted(event.currentTarget.muted)
            setVolume(event.currentTarget.volume)
          }}
          onError={(event) => {
            if (!streamUrl || event.currentTarget.currentSrc !== streamUrl) return
            previewRef.current?.fail(videoFailure(event.currentTarget))
          }}
          onLoadedMetadata={(event) => {
            if (event.currentTarget.currentSrc !== streamUrl) return
            if (Math.abs(event.currentTarget.duration - safeDuration) > 1) {
              console.warn('[Visual Trim] Preview duration differs from analyzed duration:', event.currentTarget.duration, safeDuration)
            }
            seekPreview(event.currentTarget, requestedSeek.current)
          }}
        />
        <audio
          ref={audioRef}
          data-trim-audio
          src={audioUrl ?? undefined}
          preload="metadata"
          hidden
          onLoadedMetadata={() => syncAudio(!videoRef.current?.paused)}
          onError={() => {
            if (audioUrl) setAudioError('Preview audio is unavailable or its link expired. Reanalyze the source.')
          }}
        />
      </div>

      <div className="advanced-trimmer__timeline">
        <div className="advanced-trimmer__slider" style={sliderStyle}>
          <div className="advanced-trimmer__slider-track" />
          <div className="advanced-trimmer__slider-active" />
          <input
            className="advanced-trimmer__range advanced-trimmer__range--start"
            type="range"
            min={0}
            max={safeDuration}
            step={SLIDER_STEP_SECONDS}
            value={startSeconds}
            aria-label="Trim start"
            onChange={(event) => handleStartChange(Number(event.currentTarget.value))}
          />
          <input
            className="advanced-trimmer__range advanced-trimmer__range--end"
            type="range"
            min={0}
            max={safeDuration}
            step={SLIDER_STEP_SECONDS}
            value={endSeconds}
            aria-label="Trim end"
            onChange={(event) => handleEndChange(Number(event.currentTarget.value))}
          />
        </div>
      </div>

      <div className="advanced-trimmer__footer">
        <div className="advanced-trimmer__footer-main">
          <button className="advanced-trimmer__ghost-btn" type="button" onClick={handleReset}>
            <RotateCcw size={15} aria-hidden="true" />
            Reset
          </button>
        </div>
        <button className="advanced-trimmer__save-btn" type="button" onClick={() => onConfirm(currentRange)}>
          <Check size={16} aria-hidden="true" />
          Save Trim
        </button>
      </div>
    </div>
  )
}

export default AdvancedTrimmer
