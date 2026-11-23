// Modal dialog to mux a nearby .srt/.vtt subtitle track into a downloaded video copy
import { useEffect, useRef, useState, useId } from 'react'
import { createPortal } from 'react-dom'
import { Captions, Check, CheckCircle2, Download, FileVideo, FolderOpen, Layers, LoaderCircle, Play, X } from 'lucide-react'
import { useLang } from '../../stores/useSettingsStore'
import { formatMessage, translations } from '../../translations'
import type { DownloadSubtitleFile, SubtitleMergeFormat } from '../../../../Shared/downloadSubtitles'
import './DownloadSubtitleMerge.css'

type Props = { id: string; filePath: string; title: string; onOpenFile: (filePath: string, title?: string) => void; onOpenFolder: (filePath: string) => void }
export default function DownloadSubtitleMerge({ id, filePath, title, onOpenFile, onOpenFolder }: Props) {
  const lang = useLang(), ar = lang === 'ar', copy = translations[lang].subtitles.merge
  const [files, setFiles] = useState<DownloadSubtitleFile[]>([]), [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(''), [format, setFormat] = useState<SubtitleMergeFormat>('mp4')
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState<string | null>(null), [error, setError] = useState('')
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null), active = useRef(false)
  const heading = useId()
  useEffect(() => {
    let stopped = false, generation = 0
    const refresh = async () => {
      const request = ++generation
      try { const result = await window.cortexDl.listDownloadSubtitleFiles(id); if (!stopped && request === generation) setFiles(result) } catch { if (!stopped && request === generation) setFiles([]) }
    }
    void refresh()
    window.addEventListener('focus', refresh); window.addEventListener('cortex:subtitle-files-changed', refresh)
    return () => { stopped = true; window.removeEventListener('focus', refresh); window.removeEventListener('cortex:subtitle-files-changed', refresh); if (active.current) void window.cortexDl.cancelDownloadSubtitleMerge(id).catch(() => {}) }
  }, [id, filePath])
  const close = () => { if (!busy) { setOpen(false); trigger.current?.focus() } }
  useEffect(() => {
    if (!open) return
    dialog.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!active.current) { setOpen(false); trigger.current?.focus() } }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? [])
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [open])
  const merge = async () => {
    if (!selected || active.current) return
    active.current = true; setBusy(true); setError('')
    try { const output = await window.cortexDl.mergeDownloadSubtitle(id, selected, format); if (output) setSaved(output) }
    catch (failure) {
      const unavailable = failure instanceof Error && failure.message.includes('SUBTITLE_FILE_UNAVAILABLE')
      setError(unavailable ? copy.fileUnavailable : copy.mergeFailed)
    } finally { active.current = false; setBusy(false) }
  }
  if (!files.length && !open) return null
  return <>
    {!!files.length && <button ref={trigger} type="button" className="dc-btn dc-merge" title={copy.mergeBtnTitle} onClick={() => {
      setSelected(files[0].fileName); setFormat('mp4'); setSaved(null); setError(''); setOpen(true)
    }}><Layers size={15} />{copy.mergeBtn}</button>}
    {open && createPortal(<div className="dsm-backdrop" onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div ref={dialog} className="dsm-dialog" role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1} dir={ar ? 'rtl' : 'ltr'}>
        <header className="dsm-heading"><div className="dsm-icon"><Layers size={23} /></div><div><h3 id={heading}>{copy.dialogTitle}</h3><p><bdi>{title}</bdi></p></div>
          <button type="button" className="dsm-close" disabled={busy} onClick={close} aria-label={copy.close}><X size={19} /></button></header>
        {saved ? <div className="dsm-success" role="status"><CheckCircle2 size={35} /><h4>{copy.savedTitle}</h4><p dir="auto">{saved.split(/[\\/]/).pop()}</p>
          <div className="dsm-saved-actions"><button type="button" className="dsm-play" onClick={() => { close(); onOpenFile(saved, title) }}><Play size={16} />{copy.playVideo}</button>
            <button type="button" className="dsm-secondary" onClick={() => onOpenFolder(saved)}><FolderOpen size={16} />{copy.openFolder}</button></div></div>
          : <>
            <fieldset className="dsm-files" disabled={busy}><legend>{copy.subtitleFile}</legend>
              <div className="dsm-file-list">{files.map(file => <label key={file.fileName} className={`dsm-file${selected === file.fileName ? ' selected' : ''}`}>
                <input type="radio" name={heading} value={file.fileName} checked={selected === file.fileName} onChange={() => setSelected(file.fileName)} />
                <Captions size={21} /><span><strong>{file.language === 'ar' && ar ? copy.arabicLabel : file.label}</strong><small dir="auto">{file.fileName}</small></span><Check size={17} className="dsm-check" />
              </label>)}</div>
            </fieldset>
            <fieldset className="dsm-formats" disabled={busy}><legend>{copy.videoFormat}</legend><div>{(['mp4', 'mkv'] as const).map(value => <label key={value} className={format === value ? 'selected' : ''}>
              <input type="radio" name={`${heading}-format`} checked={format === value} onChange={() => setFormat(value)} /><FileVideo size={16} />{value.toUpperCase()}{value === 'mp4' && <small>{copy.defaultTag}</small>}
            </label>)}</div></fieldset>
            <p className="dsm-note">{copy.note}</p>
            {error && <p className="dsm-error" role="alert">{error}</p>}
            <footer className="dsm-footer">{busy ? <><span className="dsm-busy" role="status"><LoaderCircle size={17} className="spin" />{copy.saving}</span><button type="button" className="dsm-secondary" onClick={() => void window.cortexDl.cancelDownloadSubtitleMerge(id)}>{copy.cancel}</button></>
              : <><button type="button" className="dsm-secondary" onClick={close}>{copy.back}</button><button type="button" className="dsm-save" disabled={!files.some(file => file.fileName === selected)} onClick={() => void merge()}><Download size={17} />{formatMessage(copy.saveFormat, { format: format.toUpperCase() })}</button></>}</footer>
          </>}
      </div>
    </div>, document.body)}
  </>
}
