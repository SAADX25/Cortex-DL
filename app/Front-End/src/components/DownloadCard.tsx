/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DownloadCard — Pure presentation component for a single download task.
 *
 *  Responsibilities:
 *  ─ Reads a flat ViewModel (from useDownloadCardVM)
 *  ─ Renders markup + CSS classes
 *  ─ ZERO business logic, ZERO IPC calls, ZERO derived state
 *
 *  Performance:
 *  ─ React.memo prevents re-render unless props change
 *  ─ The store subscription is per-task, so only THIS card updates
 * ═══════════════════════════════════════════════════════════════════════════
 */
import React from 'react'
import { Play, FolderOpen, Trash2 } from 'lucide-react'
import { useDownloadCardVM, type DisplayPhase } from '../hooks/useDownloadCardVM'
import type { Language } from '../translations'
import { translations } from '../translations'
import './DownloadCard.css'

const THUMB_FALLBACK_DATA_URI = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='90'><rect width='100%' height='100%' fill='%23081126'/><text x='50%' y='50%' font-size='12' fill='%239ca3af' dominant-baseline='middle' text-anchor='middle'>No image</text></svg>"

const SmartImage: React.FC<any> = ({ src, alt, className, style, ...rest }) => {
  const [imgSrc, setImgSrc] = React.useState<string | undefined>(src)
  React.useEffect(() => {
    let cancelled = false
    setImgSrc(src)
    if (src && /instagram|cdninstagram/i.test(src)) {
      ;(async () => {
        try {
          const dataUri = await (window as any).cortexDl.fetchThumbnail(src)
          if (!cancelled && dataUri) setImgSrc(dataUri)
        } catch (err) {
          // ignore — fallback will show placeholder
        }
      })()
    }
    return () => { cancelled = true }
  }, [src])

  return (
    // eslint-disable-next-line jsx-a11y/alt-text
    <img
      src={imgSrc || THUMB_FALLBACK_DATA_URI}
      alt={alt || ''}
      className={className}
      style={style}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(e: any) => { e.currentTarget.onerror = null; e.currentTarget.src = THUMB_FALLBACK_DATA_URI }}
      {...rest}
    />
  )
}

// ── Props ────────────────────────────────────────────────────────────────────

interface DownloadCardProps {
  id: string
  lang: Language
  onOpenFile: (filePath: string, title?: string) => void
  onOpenFolder: (filePath: string) => void
  onDelete: (id: string, deleteFile: boolean) => void
  onError: (msg: string) => void
}

// ── Progress Bar (extracted sub-component for clarity) ───────────────────────

const ProgressBar: React.FC<{
  percent: number
  phase: DisplayPhase
  isIndeterminate: boolean
}> = React.memo(({ percent, phase, isIndeterminate }) => {
  // Map phase → CSS modifier class for the fill
  const phaseToBarClass: Record<string, string> = {
    downloading: 'downloading',
    starting: 'downloading',
    merging: 'merging',
    converting: 'converting',
    trimming: 'converting',
    completed: 'completed',
    error: 'error',
    paused: 'paused',
    queued: 'queued',
    canceled: 'paused',
  }
  const barClass = phaseToBarClass[phase] || ''

  return (
    <div className="dc-bar-bg">
      <div
        className={`dc-bar-fill ${barClass} ${isIndeterminate ? 'indeterminate' : ''}`}
        style={{ width: `${isIndeterminate ? 100 : percent}%` }}
      />
    </div>
  )
})
ProgressBar.displayName = 'ProgressBar'

// ── Main Component ───────────────────────────────────────────────────────────

const DownloadCard: React.FC<DownloadCardProps> = (props) => {
  const { id, lang, onOpenFile, onOpenFolder, onDelete, onError } = props
  const t = translations[lang]
  const vm = useDownloadCardVM({ id, lang, onOpenFile, onOpenFolder, onDelete, onError })

  if (!vm) return null

  const isActive = vm.phase === 'downloading' || vm.phase === 'starting'
  const isPostProcessing = vm.phase === 'merging' || vm.phase === 'converting' || vm.phase === 'trimming'

  return (
    <div className={`dc-card ${vm.phase}`}>
      {/* ── Thumbnail ─────────────────────────────────────────── */}
      <div className="dc-thumb">
        {vm.thumbnail ? (
          <SmartImage src={vm.thumbnail} alt="" />
        ) : (
          <div className="dc-thumb-placeholder">
            {vm.formatTag === 'mp3' || vm.formatTag === 'wav' || vm.formatTag === 'm4a' || vm.formatTag === 'ogg' || vm.formatTag === 'flac' ? '🎵' : '🎬'}
          </div>
        )}
      </div>

      {/* ── Body ──────────────────────────────────────────────── */}
      <div className="dc-body">
        {/* Header: title + format badge */}
        <div className="dc-header">
          <h4 className="dc-title" title={vm.title}>{vm.title}</h4>
          <span className={`dc-format-tag ${vm.formatTag}`}>{vm.formatTag}</span>
        </div>

        {/* Status row: phase badge + stats */}
        <div className="dc-meta">
          {isPostProcessing ? (
            <span className="dc-phase-badge processing" style={{ color: vm.phaseColor }}>
              {vm.phaseLabel}
            </span>
          ) : (
            <span className={`dc-phase-badge ${vm.phase}`} style={{ color: vm.phaseColor }}>
              {isActive && <span className="dc-pulse-dot" />}
              {vm.phaseLabel}
            </span>
          )}

          {/* Stats: speed / size / ETA — render during active, post-processing, or completed */}
          {(isActive || isPostProcessing || vm.phase === 'completed') && (
            <div className="dc-stats">
              {vm.speedLabel && vm.speedLabel !== '-' && (
                <span className="dc-stat">⚡ {vm.speedLabel}</span>
              )}
              {vm.sizeLabel && (
                <span className="dc-stat">📦 {vm.sizeLabel}</span>
              )}
              {vm.etaLabel && vm.etaLabel !== '--:--' && (
                <span className="dc-stat">⏱ {vm.etaLabel}</span>
              )}
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="dc-progress">
          <ProgressBar percent={vm.percent} phase={vm.phase} isIndeterminate={vm.isIndeterminate} />
          <div className="dc-progress-info">
            <span className="dc-percent">{vm.percentLabel}</span>
          </div>
        </div>

        {/* Error message */}
        {vm.errorMessage && <div className="dc-error">{vm.errorMessage}</div>}

        {/* Actions */}
        <div className="dc-actions">
          <div className="dc-action-group">
            {vm.showPause && (
              <button className="dc-btn primary" onClick={vm.onPause}>
                {t.btn_pause}
              </button>
            )}
            {vm.showResume && (
              <button className="dc-btn success" onClick={vm.onResume}>
                {t.btn_resume}
              </button>
            )}
            {vm.showCancel && (
              <button className="dc-btn danger" onClick={vm.onCancel}>
                {t.btn_cancel}
              </button>
            )}
            {vm.showPlay && (
              <button className="dc-btn-icon ghost-success" onClick={vm.onPlay} title={t.btn_play}>
                <Play size={20} />
              </button>
            )}
            {vm.showOpenFolder && (
              <button className="dc-btn-icon ghost-warning" onClick={vm.onOpenFolder} title={t.btn_folder}>
                <FolderOpen size={20} />
              </button>
            )}
          </div>
          <div className="dc-action-group">
            <button className="dc-btn ghost" onClick={() => vm.onDelete(false)}>
              {t.btn_remove}
            </button>
            <button className="dc-btn-icon ghost-danger" onClick={() => vm.onDelete(true)} title={t.btn_delete}>
              <Trash2 size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(DownloadCard)
