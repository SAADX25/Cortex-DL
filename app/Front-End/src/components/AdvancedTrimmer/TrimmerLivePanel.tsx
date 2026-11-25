// Live stream clip duration selector with quick presets and manual nudge controls
import React from 'react'
import { formatTimecode } from './trimTime'
import { formatMessage } from '../../translations'
import type { Translations } from '../../locales/types'

const LIVE_DURATION_PRESETS = [
  { label: '15s', seconds: 15 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '2m', seconds: 120 },
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '30m', seconds: 1800 },
  { label: '1h', seconds: 3600 },
] as const

export interface TrimmerLivePanelProps {
  tr: Translations['trimmer']
  liveClipSeconds: number
  liveDraft: string
  onLiveDraftChange: (value: string) => void
  onCommitLiveDraft: () => void
  onUpdateLiveDuration: (seconds: number) => void
}

export const TrimmerLivePanel: React.FC<TrimmerLivePanelProps> = ({
  tr,
  liveClipSeconds,
  liveDraft,
  onLiveDraftChange,
  onCommitLiveDraft,
  onUpdateLiveDuration,
}) => (
  <div className="advanced-trimmer__live-panel">
    <div className="advanced-trimmer__live-info">
      <strong>{tr.liveClipLength}</strong>
      <span>{formatMessage(tr.liveClipDesc, { duration: formatTimecode(liveClipSeconds) })}</span>
    </div>

    <div className="advanced-trimmer__preset-row" dir="ltr">
      {LIVE_DURATION_PRESETS.map(preset => (
        <button
          key={preset.label}
          type="button"
          className={`advanced-trimmer__chip${liveClipSeconds === preset.seconds ? ' is-active' : ''}`}
          onClick={() => onUpdateLiveDuration(preset.seconds)}
        >
          {preset.label}
        </button>
      ))}
    </div>

    <div className="advanced-trimmer__live-custom" dir="ltr">
      <button
        type="button"
        className="advanced-trimmer__nudge-btn"
        onClick={() => onUpdateLiveDuration(liveClipSeconds - 30)}
      >
        -30s
      </button>
      <button
        type="button"
        className="advanced-trimmer__nudge-btn"
        onClick={() => onUpdateLiveDuration(liveClipSeconds - 10)}
      >
        -10s
      </button>
      <input
        type="text"
        className="advanced-trimmer__time-input"
        value={liveDraft}
        aria-label="Live clip duration"
        onChange={event => onLiveDraftChange(event.currentTarget.value)}
        onBlur={onCommitLiveDraft}
        onKeyDown={event => {
          if (event.key === 'Enter') onCommitLiveDraft()
        }}
      />
      <button
        type="button"
        className="advanced-trimmer__nudge-btn"
        onClick={() => onUpdateLiveDuration(liveClipSeconds + 10)}
      >
        +10s
      </button>
      <button
        type="button"
        className="advanced-trimmer__nudge-btn"
        onClick={() => onUpdateLiveDuration(liveClipSeconds + 30)}
      >
        +30s
      </button>
    </div>
  </div>
)
