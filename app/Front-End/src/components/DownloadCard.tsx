/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DownloadCard — High-Performance Download Card with Direct DOM Updates
 *
 *  Responsibilities:
 *  ─ Reads ViewModel from useDownloadCardVM for structural data
 *  ─ Uses DOM refs + useHighFrequencyIPC for volatile progress data
 *  ─ Directly mutates progress bar & speed text to avoid React re-renders
 *  ─ Only re-renders on structural changes (status transitions, errors)
 *
 *  Performance:
 *  ─ React.memo prevents re-render unless props change
 *  ─ useHighFrequencyIPC bypasses React reconciliation for progress updates
 *  ─ Direct DOM mutation keeps UI at 60 FPS with 20+ concurrent downloads
 * ═══════════════════════════════════════════════════════════════════════════
 */
import React, { useRef, useState } from 'react'
import { Play, FolderOpen, Trash2 } from 'lucide-react'
import { useDownloadCardVM, type DisplayPhase, type DownloadCardVM } from '../hooks/useDownloadCardVM'
import { useHighFrequencyIPC } from '../hooks/useHighFrequencyIPC'
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
    <>
      <img
        src={imgSrc || THUMB_FALLBACK_DATA_URI}
        alt="bg-blur"
        className="dc-thumb-bg"
        loading="lazy"
        referrerPolicy="no-referrer"
        aria-hidden="true"
        onError={(e: any) => { e.currentTarget.style.display = 'none' }}
      />
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
    </>
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

// ── Progress Bar (extracted sub-component with direct DOM manipulation) ──────

const ProgressBar: React.FC<{
  percent: number
  phase: DisplayPhase
  isIndeterminate: boolean
  progressBarRef?: React.RefObject<HTMLDivElement>
}> = React.memo(({ percent, phase, isIndeterminate, progressBarRef }) => {
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
        ref={progressBarRef}
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

  // ── High-Performance DOM Refs ────────────────────────────────────────────
  // These are updated directly by useHighFrequencyIPC without triggering
  // React re-renders. This keeps the UI at 60 FPS even with many downloads.
  const progressBarRef = useRef<HTMLDivElement>(null)
  const speedTextRef = useRef<HTMLSpanElement>(null)
  const percentTextRef = useRef<HTMLSpanElement>(null)
  const vmRef = useRef<DownloadCardVM | null>(vm)
  vmRef.current = vm

  // ── Force re-render only on structural status changes (rare)
  const [forceUpdateKey, setForceUpdateKey] = useState(0)

  // ── Listen to high-frequency IPC events and mutate DOM directly
  useHighFrequencyIPC(id, {
    progressBarRef,
    speedTextRef,
    percentTextRef,
    vmRef,
    onStructuralChange: () => {
      // This fires when status changes (e.g., downloading → completed)
      // Force a re-render by toggling a key
      setForceUpdateKey(k => k + 1)
    },
  })

  if (!vm) return null

  const isActive = vm.phase === 'downloading' || vm.phase === 'starting'
  const isPostProcessing = vm.phase === 'merging' || vm.phase === 'converting' || vm.phase === 'trimming'

  return (
    <div className={`dc-card ${vm.phase}`} key={forceUpdateKey}>
      {/* ── Thumbnail ─────────────────────────────────────────── */}
      <div className="dc-thumb">
        {vm.thumbnail ? (
          <SmartImage 
            src={vm.thumbnail} 
            alt="thumbnail" 
            style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '6px' }} 
          />
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
                <span className="dc-stat">
                  ⚡ <span ref={speedTextRef}>{vm.speedLabel}</span>
                </span>
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
          <ProgressBar 
            percent={vm.percent} 
            phase={vm.phase} 
            isIndeterminate={vm.isIndeterminate}
            progressBarRef={progressBarRef}
          />
          <div className="dc-progress-info">
            <span className="dc-percent" ref={percentTextRef}>{vm.percentLabel}</span>
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
