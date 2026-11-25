// Precision timecode inputs (start, duration, end), quick-clip presets, and Fast/Exact cut mode selector
import React from 'react'
import { Crosshair, Zap } from 'lucide-react'
import type { Translations } from '../../locales/types'

const VOD_DURATION_PRESETS = [
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '30m', seconds: 1800 },
] as const

export interface TrimmerPrecisionPanelProps {
  tr: Translations['trimmer']
  safeDuration: number
  currentTime: number
  startSeconds: number
  endSeconds: number
  startDraft: string
  endDraft: string
  durationDraft: string
  trimMode: 'fast' | 'exact'
  onTrimModeChange?: (mode: 'fast' | 'exact') => void
  onStartDraftChange: (value: string) => void
  onEndDraftChange: (value: string) => void
  onDurationDraftChange: (value: string) => void
  onCommitStartDraft: () => void
  onCommitEndDraft: () => void
  onCommitDurationDraft: () => void
  onUpdateStart: (seconds: number, shouldSeek?: boolean) => void
  onUpdateEnd: (seconds: number, shouldSeek?: boolean) => void
}

export const TrimmerPrecisionPanel: React.FC<TrimmerPrecisionPanelProps> = ({
  tr,
  safeDuration,
  currentTime,
  startSeconds,
  endSeconds,
  startDraft,
  endDraft,
  durationDraft,
  trimMode,
  onTrimModeChange,
  onStartDraftChange,
  onEndDraftChange,
  onDurationDraftChange,
  onCommitStartDraft,
  onCommitEndDraft,
  onCommitDurationDraft,
  onUpdateStart,
  onUpdateEnd,
}) => (
  <>
    <div className="advanced-trimmer__precision-grid">
      <div className="advanced-trimmer__field-card">
        <div className="advanced-trimmer__field-head">
          <label htmlFor="trim-start-input">{tr.startIn}</label>
          <button
            type="button"
            className="advanced-trimmer__mark-btn"
            onClick={() => onUpdateStart(currentTime, false)}
            title={tr.setPlayheadInTitle}
          >
            {tr.useCurrentIn}
          </button>
        </div>
        <div className="advanced-trimmer__field-row" dir="ltr">
          <button
            type="button"
            className="advanced-trimmer__nudge-btn"
            onClick={() => onUpdateStart(startSeconds - 5)}
          >
            -5s
          </button>
          <button
            type="button"
            className="advanced-trimmer__nudge-btn"
            onClick={() => onUpdateStart(startSeconds - 1)}
          >
            -1s
          </button>
          <input
            id="trim-start-input"
            type="text"
            className="advanced-trimmer__time-input"
            value={startDraft}
            aria-label="Start time"
            onChange={event => onStartDraftChange(event.currentTarget.value)}
            onBlur={onCommitStartDraft}
            onKeyDown={event => {
              if (event.key === 'Enter') onCommitStartDraft()
            }}
          />
          <button
            type="button"
            className="advanced-trimmer__nudge-btn"
            onClick={() => onUpdateStart(startSeconds + 1)}
          >
            +1s
          </button>
          <button
            type="button"
            className="advanced-trimmer__nudge-btn"
            onClick={() => onUpdateStart(startSeconds + 5)}
          >
            +5s
          </button>
        </div>
      </div>

      <div className="advanced-trimmer__field-card">
        <div className="advanced-trimmer__field-head">
          <label htmlFor="trim-duration-input">{tr.clipDuration}</label>
          <div className="advanced-trimmer__quick-chips" dir="ltr">
            {VOD_DURATION_PRESETS.filter(p => p.seconds <= safeDuration)
              .slice(0, 4)
              .map(preset => (
                <button
                  key={preset.label}
                  type="button"
                  className="advanced-trimmer__tiny-chip"
                  onClick={() => onUpdateEnd(Math.min(safeDuration, startSeconds + preset.seconds))}
                >
                  +{preset.label}
                </button>
              ))}
          </div>
        </div>
        <div className="advanced-trimmer__field-row" dir="ltr">
          <input
            id="trim-duration-input"
            type="text"
            className="advanced-trimmer__time-input advanced-trimmer__time-input--wide"
            value={durationDraft}
            aria-label="Clip duration"
            onChange={event => onDurationDraftChange(event.currentTarget.value)}
            onBlur={onCommitDurationDraft}
            onKeyDown={event => {
              if (event.key === 'Enter') onCommitDurationDraft()
            }}
          />
        </div>
      </div>

      <div className="advanced-trimmer__field-card">
        <div className="advanced-trimmer__field-head">
          <label htmlFor="trim-end-input">{tr.endOut}</label>
          <button
            type="button"
            className="advanced-trimmer__mark-btn"
            onClick={() => onUpdateEnd(currentTime, false)}
            title={tr.setPlayheadOutTitle}
          >
            {tr.useCurrentOut}
          </button>
        </div>
        <div className="advanced-trimmer__field-row" dir="ltr">
          <button
            type="button"
            className="advanced-trimmer__nudge-btn"
            onClick={() => onUpdateEnd(endSeconds - 5)}
          >
            -5s
          </button>
          <button
            type="button"
            className="advanced-trimmer__nudge-btn"
            onClick={() => onUpdateEnd(endSeconds - 1)}
          >
            -1s
          </button>
          <input
            id="trim-end-input"
            type="text"
            className="advanced-trimmer__time-input"
            value={endDraft}
            aria-label="End time"
            onChange={event => onEndDraftChange(event.currentTarget.value)}
            onBlur={onCommitEndDraft}
            onKeyDown={event => {
              if (event.key === 'Enter') onCommitEndDraft()
            }}
          />
          <button
            type="button"
            className="advanced-trimmer__nudge-btn"
            onClick={() => onUpdateEnd(endSeconds + 1)}
          >
            +1s
          </button>
          <button
            type="button"
            className="advanced-trimmer__nudge-btn"
            onClick={() => onUpdateEnd(endSeconds + 5)}
          >
            +5s
          </button>
        </div>
      </div>
    </div>

    {onTrimModeChange && (
      <div className="advanced-trimmer__mode-bar">
        <div className="advanced-trimmer__mode-toggle" role="group" aria-label={tr.trimModeLabel}>
          <button
            type="button"
            className={`advanced-trimmer__mode-btn${trimMode === 'fast' ? ' is-active' : ''}`}
            onClick={() => onTrimModeChange('fast')}
            aria-pressed={trimMode === 'fast'}
            title={tr.fastModeTitle}
          >
            <Zap size={13} aria-hidden="true" />
            <span>{tr.fastMode}</span>
          </button>
          <button
            type="button"
            className={`advanced-trimmer__mode-btn${trimMode === 'exact' ? ' is-active is-exact' : ''}`}
            onClick={() => onTrimModeChange('exact')}
            aria-pressed={trimMode === 'exact'}
            title={tr.exactModeTitle}
          >
            <Crosshair size={13} aria-hidden="true" />
            <span>{tr.exactMode}</span>
          </button>
        </div>
        <span className="advanced-trimmer__mode-hint">
          {trimMode === 'fast' ? tr.fastModeHint : tr.exactModeHint}
        </span>
      </div>
    )}
  </>
)
