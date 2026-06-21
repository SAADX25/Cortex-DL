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
  const [thumbPort, setThumbPort] = React.useState(3345)

  
  React.useEffect(() => {
    if (window.cortexDl?.getMediaPort) {
      window.cortexDl.getMediaPort().then((port) => setThumbPort(port)).catch(() => {})
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    setImgSrc(src)
    if (src && /instagram|cdninstagram/i.test(src)) {
      (async () => {
        try {
          const filePath = await window.cortexDl.fetchThumbnail(src)
          if (!cancelled && filePath) {
            
            const streamUrl = `http://127.0.0.1:${thumbPort}/?path=${encodeURIComponent(filePath)}`
            setImgSrc(streamUrl)
          }
        } catch (err) {
          
        }
      })()
    }
    return () => { cancelled = true }
  }, [src, thumbPort])

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

interface DownloadCardProps {
  id: string
  lang: Language
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
  const { id, lang, onOpenFile, onOpenFolder, onDelete, onError } = props
  const t = translations[lang]
  const vm = useDownloadCardVM({ id, lang, onOpenFile, onOpenFolder, onDelete, onError })

  
  
  
  const progressBarRef = useRef<HTMLDivElement>(null)
  const speedTextRef = useRef<HTMLSpanElement>(null)
  const percentTextRef = useRef<HTMLSpanElement>(null)
  const vmRef = useRef<DownloadCardVM | null>(vm)
  vmRef.current = vm

  
  const [forceUpdateKey, setForceUpdateKey] = useState(0)

  
  useHighFrequencyIPC(id, {
    progressBarRef,
    speedTextRef,
    percentTextRef,
    vmRef,
    onStructuralChange: () => {
      
      
      setForceUpdateKey(k => k + 1)
    },
  })

  if (!vm) return null

  const isActive = vm.phase === 'downloading' || vm.phase === 'starting'
  const isPostProcessing = vm.phase === 'merging' || vm.phase === 'converting' || vm.phase === 'trimming'

  return (
    <div className={`dc-card ${vm.phase}`} key={forceUpdateKey}>
      {}
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

      {}
      <div className="dc-body">
        {}
        <div className="dc-header">
          <h4 className="dc-title" title={vm.title}>{vm.title}</h4>
          <span className={`dc-format-tag ${vm.formatTag}`}>{vm.formatTag}</span>
        </div>

        {}
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

          {}
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

        {}
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

        {}
        {vm.errorMessage && <div className="dc-error">{vm.errorMessage}</div>}

        {}
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
