// Zoomable timeline ruler, draggable start/end handles, playhead scrubber, and pan bar for VOD trimming
import React, { useEffect } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { clampSeconds, formatCompactTime, formatTimecode, type RulerTick } from './trimTime'
import type { Translations } from '../../locales/types'

const ZOOM_STEPS = [1, 2, 4, 8, 16, 32, 64] as const
const SLIDER_STEP_SECONDS = 0.1

export type DragState = null | {
  kind: 'start' | 'end' | 'move' | 'scrub'
  originX: number
  originStart: number
  originEnd: number
}

export interface TrimmerTimelineProps {
  tr: Translations['trimmer']
  trackRef: React.RefObject<HTMLDivElement>
  safeDuration: number
  startSeconds: number
  endSeconds: number
  clipDurationSeconds: number
  zoom: number
  viewport: { viewStart: number; viewEnd: number; viewDuration: number }
  rulerTicks: RulerTick[]
  activeDrag: DragState
  startPct: number
  endPct: number
  playheadPct: number
  playheadVisible: boolean
  onChangeZoom: (nextZoom: number, focusTime?: number) => void
  onZoomToSelection: () => void
  onResetZoom: () => void
  onSetViewStart: React.Dispatch<React.SetStateAction<number>>
  onSetActiveDrag: React.Dispatch<React.SetStateAction<DragState>>
  onSeekVideo: (seconds: number) => void
  onPointerToTime: (clientX: number) => number
  onUpdateStart: (seconds: number) => void
  onUpdateEnd: (seconds: number) => void
}

export const TrimmerTimeline: React.FC<TrimmerTimelineProps> = ({
  tr,
  trackRef,
  safeDuration,
  startSeconds,
  endSeconds,
  clipDurationSeconds,
  zoom,
  viewport,
  rulerTicks,
  activeDrag,
  startPct,
  endPct,
  playheadPct,
  playheadVisible,
  onChangeZoom,
  onZoomToSelection,
  onResetZoom,
  onSetViewStart,
  onSetActiveDrag,
  onSeekVideo,
  onPointerToTime,
  onUpdateStart,
  onUpdateEnd,
}) => {
  const sliderStyle = {
    '--trim-start': `${startPct}%`,
    '--trim-end': `${endPct}%`,
  } as React.CSSProperties & Record<'--trim-start' | '--trim-end', string>

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const handleWheel = (event: WheelEvent) => {
      if (safeDuration <= 0) return
      if (event.ctrlKey) {
        event.preventDefault()
        const factor = event.deltaY < 0 ? 1.5 : 1 / 1.5
        onChangeZoom(zoom * factor, onPointerToTime(event.clientX))
      } else if (zoom > 1) {
        event.preventDefault()
        const shift = (event.deltaY > 0 ? 1 : -1) * viewport.viewDuration * 0.15
        onSetViewStart(prev =>
          clampSeconds(prev + shift, 0, Math.max(0, safeDuration - viewport.viewDuration)),
        )
      }
    }
    track.addEventListener('wheel', handleWheel, { passive: false })
    return () => track.removeEventListener('wheel', handleWheel)
  }, [
    trackRef,
    safeDuration,
    zoom,
    viewport.viewDuration,
    onChangeZoom,
    onPointerToTime,
    onSetViewStart,
  ])

  return (
    <div className="advanced-trimmer__timeline-section">
      <div className="advanced-trimmer__timeline-bar">
        <div className="advanced-trimmer__timeline-meta">
          <span>
            {tr.clipLabel} <strong>{formatTimecode(clipDurationSeconds)}</strong>
          </span>
          <span className="advanced-trimmer__divider">•</span>
          <span>
            {tr.zoomLabel} <strong>{zoom}x</strong>
          </span>
        </div>

        <div className="advanced-trimmer__zoom-controls" dir="ltr">
          <button
            type="button"
            className="advanced-trimmer__mini-btn"
            disabled={zoom <= 1}
            onClick={() => {
              const prev = [...ZOOM_STEPS].reverse().find(z => z < zoom) ?? 1
              onChangeZoom(prev)
            }}
            aria-label="Zoom out timeline"
            title={tr.zoomOut}
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            className="advanced-trimmer__mini-btn"
            disabled={zoom >= 64}
            onClick={() => {
              const next = ZOOM_STEPS.find(z => z > zoom) ?? 64
              onChangeZoom(next)
            }}
            aria-label="Zoom in timeline"
            title={tr.zoomIn}
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            className="advanced-trimmer__mini-btn"
            onClick={onZoomToSelection}
            title={tr.fitSelectionTitle}
          >
            {tr.fitClip}
          </button>
          {zoom > 1 && (
            <button type="button" className="advanced-trimmer__mini-btn" onClick={onResetZoom}>
              1x
            </button>
          )}
        </div>
      </div>

      <div
        className="advanced-trimmer__ruler"
        dir="ltr"
        onPointerDown={event => {
          onSeekVideo(onPointerToTime(event.clientX))
          onSetActiveDrag({
            kind: 'scrub',
            originX: event.clientX,
            originStart: startSeconds,
            originEnd: endSeconds,
          })
        }}
      >
        {rulerTicks.map(tick => (
          <div
            key={`${tick.time}-${tick.major}`}
            className={`advanced-trimmer__tick${tick.major ? ' is-major' : ''}`}
            style={{ left: `${tick.percent}%` }}
          >
            <span className="advanced-trimmer__tick-line" />
            {tick.major && <span className="advanced-trimmer__tick-label">{tick.label}</span>}
          </div>
        ))}
      </div>

      <div
        ref={trackRef}
        className="advanced-trimmer__track"
        dir="ltr"
        style={sliderStyle}
        onPointerDown={event => {
          if ((event.target as HTMLElement).closest('[data-trim-handle],[data-trim-selection]'))
            return
          onSeekVideo(onPointerToTime(event.clientX))
          onSetActiveDrag({
            kind: 'scrub',
            originX: event.clientX,
            originStart: startSeconds,
            originEnd: endSeconds,
          })
        }}
      >
        <div
          className="advanced-trimmer__mask advanced-trimmer__mask--left"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="advanced-trimmer__mask advanced-trimmer__mask--right"
          style={{ width: `${Math.max(0, 100 - endPct)}%` }}
        />

        <div
          data-trim-selection
          className="advanced-trimmer__selection"
          style={{ left: `${startPct}%`, width: `${Math.max(0.5, endPct - startPct)}%` }}
          title={tr.dragWindowTitle}
          onPointerDown={event => {
            event.stopPropagation()
            onSetActiveDrag({
              kind: 'move',
              originX: event.clientX,
              originStart: startSeconds,
              originEnd: endSeconds,
            })
          }}
        />

        <button
          type="button"
          data-trim-handle="start"
          className={`advanced-trimmer__handle advanced-trimmer__handle--start${activeDrag?.kind === 'start' ? ' is-dragging' : ''}`}
          style={{ left: `${startPct}%` }}
          aria-label="Drag trim start handle"
          onPointerDown={event => {
            event.stopPropagation()
            onSetActiveDrag({
              kind: 'start',
              originX: event.clientX,
              originStart: startSeconds,
              originEnd: endSeconds,
            })
          }}
        >
          <span className="advanced-trimmer__handle-grip" />
        </button>

        <button
          type="button"
          data-trim-handle="end"
          className={`advanced-trimmer__handle advanced-trimmer__handle--end${activeDrag?.kind === 'end' ? ' is-dragging' : ''}`}
          style={{ left: `${endPct}%` }}
          aria-label="Drag trim end handle"
          onPointerDown={event => {
            event.stopPropagation()
            onSetActiveDrag({
              kind: 'end',
              originX: event.clientX,
              originStart: startSeconds,
              originEnd: endSeconds,
            })
          }}
        >
          <span className="advanced-trimmer__handle-grip" />
        </button>

        {playheadVisible && (
          <div
            className="advanced-trimmer__playhead"
            style={{ left: `${playheadPct}%` }}
            aria-hidden="true"
          />
        )}

        <input
          className="advanced-trimmer__range advanced-trimmer__range--start"
          type="range"
          min={0}
          max={safeDuration}
          step={SLIDER_STEP_SECONDS}
          value={startSeconds}
          aria-label="Trim start"
          onChange={event => onUpdateStart(Number(event.currentTarget.value))}
        />
        <input
          className="advanced-trimmer__range advanced-trimmer__range--end"
          type="range"
          min={0}
          max={safeDuration}
          step={SLIDER_STEP_SECONDS}
          value={endSeconds}
          aria-label="Trim end"
          onChange={event => onUpdateEnd(Number(event.currentTarget.value))}
        />
      </div>

      {zoom > 1 && (
        <div className="advanced-trimmer__pan-row" dir="ltr">
          <span className="advanced-trimmer__pan-label">
            {formatCompactTime(viewport.viewStart)}
          </span>
          <input
            type="range"
            className="advanced-trimmer__pan-slider"
            min={0}
            max={Math.max(0, safeDuration - viewport.viewDuration)}
            step={Math.max(0.1, viewport.viewDuration / 200)}
            value={viewport.viewStart}
            aria-label="Pan zoomed timeline"
            onChange={event => onSetViewStart(Number(event.currentTarget.value))}
          />
          <span className="advanced-trimmer__pan-label">{formatCompactTime(viewport.viewEnd)}</span>
        </div>
      )}
    </div>
  )
}
