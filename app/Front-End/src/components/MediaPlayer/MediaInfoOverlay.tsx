import { Info, X } from 'lucide-react'
import { useState, useEffect, useRef, useId } from 'react'
import { parseFrameRate } from '../../../../Shared/frameRate'
import { useLang } from '../../stores/useSettingsStore'

interface MediaInfoProps {
  title: string
  filePath: string
  videoWidth?: number
  videoHeight?: number
  mediaType: 'video' | 'audio'
  showOverlay: boolean
  toggleOverlay: () => void
  closeOverlay: () => void
  taskFps?: number | string
  sessionId: string
}

type FpsResult = { key: string; status: 'loading' | 'ready' | 'unavailable'; value: number | null }

export function MediaInfoOverlay({ filePath, videoWidth, videoHeight, mediaType, showOverlay, toggleOverlay, closeOverlay, taskFps, sessionId }: MediaInfoProps) {
  const lang = useLang()
  const labels = lang === 'ar'
    ? { title: 'معلومات الفيديو', format: 'الصيغة', resolution: 'الدقة', loading: 'جارٍ القراءة…', unavailable: 'غير متاح', close: 'إغلاق المعلومات' }
    : { title: 'Media Information', format: 'Format', resolution: 'Resolution', loading: 'Reading…', unavailable: 'Unavailable', close: 'Close information' }
  const extension = filePath.split('.').pop()?.toUpperCase() || 'UNKNOWN'
  const panelId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const cachedFps = useRef<{ key: string; value: number } | null>(null)
  const key = `${sessionId}:${filePath}`
  const [result, setResult] = useState<FpsResult | null>(null)

  useEffect(() => {
    if (!showOverlay || mediaType !== 'video') return
    let cancelled = false
    const key = `${sessionId}:${filePath}`
    const known = parseFrameRate(taskFps) ?? (cachedFps.current?.key === key ? cachedFps.current.value : null)
    if (known !== null) {
      setResult({ key, status: 'ready', value: known })
      return
    }
    setResult({ key, status: 'loading', value: null })
    const read = async () => {
      let value: number | null = null
      try { value = parseFrameRate(await window.cortexDl?.getMediaFps?.(filePath, sessionId)) }
      catch { /* A failed read is retryable when the panel is reopened. */ }
      if (cancelled) return
      if (value !== null) cachedFps.current = { key, value }
      setResult({ key, status: value === null ? 'unavailable' : 'ready', value })
    }
    void read()
    return () => { cancelled = true }
  }, [showOverlay, filePath, mediaType, sessionId, taskFps])

  useEffect(() => {
    if (!showOverlay) return
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) closeOverlay()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeOverlay()
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [showOverlay, closeOverlay])

  const current = result?.key === key ? result : null
  const fpsLabel = current?.status === 'ready' && current.value !== null
    ? `${Number(current.value.toFixed(3))} FPS`
    : current?.status === 'unavailable' ? labels.unavailable : labels.loading

  return <>
    <button ref={buttonRef} type="button" className={`media-info-toggle ${showOverlay ? 'active' : ''}`}
      onClick={event => { event.stopPropagation(); toggleOverlay() }} title={labels.title} aria-label={labels.title}
      aria-expanded={showOverlay} aria-controls={showOverlay ? panelId : undefined}>
      <Info size={20} />
    </button>
    {showOverlay && <div ref={panelRef} id={panelId} className="media-info-panel" role="dialog" aria-label={labels.title} onClick={event => event.stopPropagation()}>
      <div className="media-info-heading">
        <h4 className="media-info-title">{labels.title}</h4>
        <button type="button" className="media-info-close" onClick={closeOverlay} title={labels.close} aria-label={labels.close}><X size={16} /></button>
      </div>
      <div className="media-info-grid">
        <span className="info-label">{labels.format}</span><span className="info-value">{extension}</span>
        {mediaType === 'video' && !!videoWidth && !!videoHeight && <>
          <span className="info-label">{labels.resolution}</span><span className="info-value" dir="ltr">{videoWidth} × {videoHeight}</span>
        </>}
        {mediaType === 'video' && <>
          <span className="info-label">FPS</span><span className="info-value path-value" dir="ltr" aria-live="polite">{fpsLabel}</span>
        </>}
      </div>
    </div>}
  </>
}
