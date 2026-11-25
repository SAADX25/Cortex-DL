// Fast/Exact cut mode selector bar for VOD trimming
import React from 'react'
import { Crosshair, Zap } from 'lucide-react'
import type { Translations } from '../../locales/types'

export interface TrimmerPrecisionPanelProps {
  tr: Translations['trimmer']
  trimMode: 'fast' | 'exact'
  onTrimModeChange?: (mode: 'fast' | 'exact') => void
}

export const TrimmerPrecisionPanel: React.FC<TrimmerPrecisionPanelProps> = ({
  tr,
  trimMode,
  onTrimModeChange,
}) =>
  onTrimModeChange ? (
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
  ) : null
