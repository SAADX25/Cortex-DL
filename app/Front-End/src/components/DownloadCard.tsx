import React, { useRef, useState } from 'react'
import { Play, FolderOpen, Trash2 } from 'lucide-react'
import { useDownloadCardVM, type DisplayPhase, type DownloadCardVM } from '../hooks/useDownloadCardVM'
import { useHighFrequencyIPC } from '../hooks/useHighFrequencyIPC'
import { useLang } from '../stores/useSettingsStore'
import { translations } from '../translations'
import SmartImage from './SmartImage'
import './DownloadCard.css'

interface DownloadCardProps {
  id: string
  onOpenFile: (filePath: string, title?: string) => void
  onOpenFolder: (filePath: string) => void
  onDelete: (id: string, deleteFile: boolean) => void
  onError: (msg: string) => void
}

const ProgressBar: React.FC<{
  percent: number
  phase: DisplayPhase
  isIndeterminate: boolean
  progressBarRef?: React.RefObject<HTMLDivElement>
}> = React.memo(({ percent, phase, isIndeterminate, progressBarRef }) => {
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

const DownloadCard: React.FC<DownloadCardProps> = (props) => {
  const { id, onOpenFile, onOpenFolder, onDelete, onError } = props
  const lang = useLang()
  const t = translations[lang]
  const vm = useDownloadCardVM({ id, lang, onOpenFile, onOpenFolder, onDelete, onError })

  const progressBarRef = useRef<HTMLDivElement>(null)
  const speedTextRef = useRef<HTMLSpanElement>(null)
  const percentTextRef = useRef<HTMLSpanElement>(null)
  const vmRef = useRef<DownloadCardVM | null>(vm)
  vmRef.current = vm

  /**
   * Use a state flag for structural re-renders instead of `key`.
   * Changing `key` on the card root causes full unmount → remount,
   * which breaks CSS transitions and causes a visible flash.
   * A simple boolean toggle triggers a targeted React re-render
   * while keeping the DOM node alive.
   */
  const [structuralVersion, setStructuralVersion] = useState(0)

  useHighFrequencyIPC(id, {
    progressBarRef,
    speedTextRef,
    percentTextRef,
    vmRef,
    onStructuralChange: () => {
      setStructuralVersion((v) => v + 1)
    },
  })

  // Suppress the structuralVersion lint warning — it's intentionally used
  // only to trigger a re-render, not referenced in JSX.
  void structuralVersion

  if (!vm) return null

  const isActive = vm.phase === 'downloading' || vm.phase === 'starting'
  const isPostProcessing = vm.phase === 'merging' || vm.phase === 'converting' || vm.phase === 'trimming'

  return (
    <div className={`dc-card ${vm.phase}`}>
      {/* Thumbnail */}
      <div className="dc-thumb">
        {vm.thumbnail ? (
          <SmartImage
            src={vm.thumbnail}
            alt="thumbnail"
            withBlurBg
            style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '6px' }}
          />
        ) : (
          <div className="dc-thumb-placeholder">
            {vm.formatTag === 'mp3' || vm.formatTag === 'wav' || vm.formatTag === 'm4a' || vm.formatTag === 'ogg' || vm.formatTag === 'flac' ? '🎵' : '🎬'}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="dc-body">
        {/* Header */}
        <div className="dc-header">
          <h4 className="dc-title" title={vm.title}>{vm.title}</h4>
          <span className={`dc-format-tag ${vm.formatTag}`}>{vm.formatTag}</span>
        </div>

        {/* Meta row */}
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

        {/* Action buttons */}
        <div className="dc-actions">
          <div className="dc-action-group">
            {vm.showPause && (
              <button className="dc-btn primary" onClick={vm.onPause} aria-label={t.btn_pause}>
                {t.btn_pause}
              </button>
            )}
            {vm.showResume && (
              <button className="dc-btn success" onClick={vm.onResume} aria-label={t.btn_resume}>
                {t.btn_resume}
              </button>
            )}
            {vm.showCancel && (
              <button className="dc-btn danger" onClick={vm.onCancel} aria-label={t.btn_cancel}>
                {t.btn_cancel}
              </button>
            )}
            {vm.showPlay && (
              <button className="dc-btn-icon ghost-success" onClick={vm.onPlay} title={t.btn_play} aria-label={t.btn_play}>
                <Play size={20} />
              </button>
            )}
            {vm.showOpenFolder && (
              <button className="dc-btn-icon ghost-warning" onClick={vm.onOpenFolder} title={t.btn_folder} aria-label={t.btn_folder}>
                <FolderOpen size={20} />
              </button>
            )}
          </div>
          <div className="dc-action-group">
            <button className="dc-btn ghost" onClick={() => vm.onDelete(false)} aria-label={t.btn_remove}>
              {t.btn_remove}
            </button>
            <button className="dc-btn-icon ghost-danger" onClick={() => vm.onDelete(true)} title={t.btn_delete} aria-label={t.btn_delete}>
              <Trash2 size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(DownloadCard)
