import React, { useRef, useState } from 'react'
import { Play, FolderOpen, Trash2, X, Pause, RotateCcw, CheckCircle2, FileVideo, Music2, HardDrive, Gauge, Clock3 } from 'lucide-react'
import { useDownloadCardVM, type DisplayPhase } from '../hooks/useDownloadCardVM'
import { useHighFrequencyIPC } from '../hooks/useHighFrequencyIPC'
import { useLang } from '../stores/useSettingsStore'
import { translations } from '../translations'
import SmartImage from './SmartImage'
import { AUDIO_FORMATS } from '../../../Shared/types'
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
    preparing: 'downloading',
    validating: 'converting',
    finalizing: 'converting',
    pausing: 'paused',
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
  const [thumbnailAspect, setThumbnailAspect] = useState<{ source: string; ratio: number } | null>(null)

  useHighFrequencyIPC(id, {
    progressBarRef,
    speedTextRef,
    percentTextRef,
  })

  if (!vm) return null

  const isActive = vm.phase === 'downloading' || vm.phase === 'starting'
  const isPostProcessing = vm.phase === 'merging' || vm.phase === 'converting' || vm.phase === 'trimming'
  const aspect = thumbnailAspect?.source === vm.thumbnail ? thumbnailAspect.ratio : null
  const isShort = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\//i.test(vm.sourceUrl)
    || /\/oar(?:default|[123])\.(?:jpg|webp)(?:\?|$)/i.test(vm.thumbnail ?? '')
  const isPortrait = isShort || (aspect !== null && aspect < 0.9)

  return (
    <div className={`dc-card ${vm.phase}`}>
      {/* Thumbnail */}
      <div className={`dc-thumb${isPortrait ? ' portrait' : ''}${isShort && aspect !== null && aspect >= 1 ? ' short-letterboxed' : ''}`}>
        {vm.thumbnail ? (
          <SmartImage
            src={vm.thumbnail}
            alt={vm.title}
            withBlurBg
            onLoad={event => {
              const image = event.currentTarget
              if (vm.thumbnail && image.naturalWidth > 0 && image.naturalHeight > 0) {
                const ratio = image.naturalWidth / image.naturalHeight
                setThumbnailAspect(current => current?.source === vm.thumbnail && current.ratio === ratio ? current : { source: vm.thumbnail!, ratio })
              }
            }}
          />
        ) : (
          <div className="dc-thumb-placeholder">
            {AUDIO_FORMATS.includes(vm.formatTag as (typeof AUDIO_FORMATS)[number]) ? <Music2 size={30} /> : <FileVideo size={30} />}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="dc-body">
        {/* Header */}
        <div className="dc-header">
          <h4 className="dc-title" title={vm.title} dir="auto">{vm.title}</h4>
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
              {vm.phase === 'completed' && <CheckCircle2 size={14} />}
              {vm.phaseLabel}
            </span>
          )}

          {(isActive || isPostProcessing || vm.phase === 'completed') && (
            <div className="dc-stats">
              {vm.speedLabel && vm.speedLabel !== '-' && (
                <span className="dc-stat" dir="ltr">
                  <Gauge size={13} /> <span ref={speedTextRef}>{vm.speedLabel}</span>
                </span>
              )}
              {vm.sizeLabel && (
                <span className="dc-stat" dir="ltr"><HardDrive size={13} /> {vm.sizeLabel}</span>
              )}
              {vm.etaLabel && vm.etaLabel !== '--:--' && (
                <span className="dc-stat" dir="ltr"><Clock3 size={13} /> {vm.etaLabel}</span>
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
                <Pause size={15} />{lang === 'ar' ? 'إيقاف' : 'Pause'}
              </button>
            )}
            {vm.showResume && (
              <button className="dc-btn success" onClick={vm.onResume} aria-label={t.btn_resume}>
                <RotateCcw size={15} />{lang === 'ar' ? 'استئناف' : 'Resume'}
              </button>
            )}
            {vm.showCancel && (
              <button className="dc-btn danger" onClick={vm.onCancel} aria-label={t.btn_cancel}>
                <X size={15} />{lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
            )}
            {vm.showPlay && (
              <button className="dc-btn dc-play" onClick={vm.onPlay} title={t.btn_play} aria-label={t.btn_play}>
                <Play size={15} />{lang === 'ar' ? 'تشغيل' : 'Play'}
              </button>
            )}
            {vm.showOpenFolder && (
              <button className="dc-btn-icon ghost-warning" onClick={vm.onOpenFolder} title={t.btn_folder} aria-label={t.btn_folder}>
                <FolderOpen size={17} />
              </button>
            )}
          </div>
          <div className="dc-action-group">
            <button className="dc-btn-icon" onClick={() => vm.onDelete(false)} title={lang === 'ar' ? 'إزالة من القائمة' : 'Remove from list'} aria-label={t.btn_remove}>
              <X size={17} />
            </button>
            <button className="dc-btn-icon ghost-danger" onClick={() => vm.onDelete(true)} title={t.btn_delete} aria-label={t.btn_delete}>
              <Trash2 size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(DownloadCard)
