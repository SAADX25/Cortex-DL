import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Loader, RotateCcw, Scissors } from 'lucide-react'
import './AdvancedTrimmer.css'

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

  useEffect(() => {
    let cancelled = false

    setStreamUrl(null)
    setStreamError(null)

    if (originalUrl) {
      setIsResolvingStream(true)

      window.cortexDl
        .getDirectStreamUrl(originalUrl)
        .then((directUrl) => {
          if (!cancelled) {
            setStreamUrl(directUrl)
            setIsResolvingStream(false)
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setStreamError(
              err instanceof Error ? err.message : 'Failed to extract preview stream.',
            )
            setIsResolvingStream(false)
          }
        })
    } else if (videoUrl) {
      setStreamUrl(videoUrl)
      setIsResolvingStream(false)
    } else {
      setIsResolvingStream(false)
    }

    return () => {
      cancelled = true
    }
  }, [videoUrl, originalUrl])

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
    if (!videoRef.current) return
    videoRef.current.currentTime = clamp(seconds, 0, safeDuration)
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
        {isResolvingStream ? (
          <div className="advanced-trimmer__loading-overlay">
            <Loader size={28} className="advanced-trimmer__spinner" aria-hidden="true" />
            <span>Extracting preview stream…</span>
          </div>
        ) : streamError ? (
          <div className="advanced-trimmer__notice advanced-trimmer__notice--error">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{streamError}</span>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="advanced-trimmer__video"
            src={streamUrl ?? undefined}
            controls
            muted
            preload="auto"
            onError={() =>
              setStreamError('Preview failed to load. The trim range can still be saved.')
            }
            onLoadedMetadata={() => setStreamError(null)}
          />
        )}
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
        <button className="advanced-trimmer__ghost-btn" type="button" onClick={handleReset}>
          <RotateCcw size={15} aria-hidden="true" />
          Reset
        </button>
        <button className="advanced-trimmer__save-btn" type="button" onClick={() => onConfirm(currentRange)}>
          <Check size={16} aria-hidden="true" />
          Save Trim
        </button>
      </div>
    </div>
  )
}

export default AdvancedTrimmer
