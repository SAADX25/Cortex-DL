import { useEffect, useRef, useState, useId } from 'react'
import { createPortal } from 'react-dom'
import { Captions, Check, CheckCircle2, Download, FileVideo, FolderOpen, Layers, LoaderCircle, Play, X } from 'lucide-react'
import { useLang } from '../../stores/useSettingsStore'
import type { DownloadSubtitleFile, SubtitleMergeFormat } from '../../../../Shared/downloadSubtitles'
import './DownloadSubtitleMerge.css'

type Props = { id: string; filePath: string; title: string; onOpenFile: (filePath: string, title?: string) => void; onOpenFolder: (filePath: string) => void }
export default function DownloadSubtitleMerge({ id, filePath, title, onOpenFile, onOpenFolder }: Props) {
  const ar = useLang() === 'ar'
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
      setError(unavailable ? (ar ? 'ملف الترجمة لم يعد متاحًا. أعد فتح هذه النافذة.' : 'The subtitle file is no longer available. Reopen this window.')
        : (ar ? 'تعذر الدمج. تحقق من المحركات وملف الترجمة، أو جرّب صيغة MKV.' : 'Could not merge. Check your engines and subtitle file, or try MKV.'))
    } finally { active.current = false; setBusy(false) }
  }
  if (!files.length && !open) return null
  return <>
    {!!files.length && <button ref={trigger} type="button" className="dc-btn dc-merge" title={ar ? 'دمج ملف ترجمة متاح مع الفيديو' : 'Embed an available subtitle file in this video'} onClick={() => {
      setSelected(files[0].fileName); setFormat('mp4'); setSaved(null); setError(''); setOpen(true)
    }}><Layers size={15} />{ar ? 'دمج الترجمة' : 'Merge subtitles'}</button>}
    {open && createPortal(<div className="dsm-backdrop" onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div ref={dialog} className="dsm-dialog" role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1} dir={ar ? 'rtl' : 'ltr'}>
        <header className="dsm-heading"><div className="dsm-icon"><Layers size={23} /></div><div><h3 id={heading}>{ar ? 'دمج الترجمة مع الفيديو' : 'Merge subtitles with video'}</h3><p><bdi>{title}</bdi></p></div>
          <button type="button" className="dsm-close" disabled={busy} onClick={close} aria-label={ar ? 'إغلاق' : 'Close'}><X size={19} /></button></header>
        {saved ? <div className="dsm-success" role="status"><CheckCircle2 size={35} /><h4>{ar ? 'تم حفظ الفيديو مع الترجمة' : 'Subtitled video saved'}</h4><p dir="auto">{saved.split(/[\\/]/).pop()}</p>
          <div className="dsm-saved-actions"><button type="button" className="dsm-play" onClick={() => { close(); onOpenFile(saved, title) }}><Play size={16} />{ar ? 'تشغيل الفيديو' : 'Play video'}</button>
            <button type="button" className="dsm-secondary" onClick={() => onOpenFolder(saved)}><FolderOpen size={16} />{ar ? 'فتح المجلد' : 'Open folder'}</button></div></div>
          : <>
            <fieldset className="dsm-files" disabled={busy}><legend>{ar ? 'ملف الترجمة' : 'Subtitle file'}</legend>
              <div className="dsm-file-list">{files.map(file => <label key={file.fileName} className={`dsm-file${selected === file.fileName ? ' selected' : ''}`}>
                <input type="radio" name={heading} value={file.fileName} checked={selected === file.fileName} onChange={() => setSelected(file.fileName)} />
                <Captions size={21} /><span><strong>{file.language === 'ar' && ar ? 'العربية' : file.label}</strong><small dir="auto">{file.fileName}</small></span><Check size={17} className="dsm-check" />
              </label>)}</div>
            </fieldset>
            <fieldset className="dsm-formats" disabled={busy}><legend>{ar ? 'صيغة الفيديو' : 'Video format'}</legend><div>{(['mp4', 'mkv'] as const).map(value => <label key={value} className={format === value ? 'selected' : ''}>
              <input type="radio" name={`${heading}-format`} checked={format === value} onChange={() => setFormat(value)} /><FileVideo size={16} />{value.toUpperCase()}{value === 'mp4' && <small>{ar ? 'الافتراضي' : 'Default'}</small>}
            </label>)}</div></fieldset>
            <p className="dsm-note">{ar ? 'حفظ نسخة جديدة بجودة الفيديو والصوت الأصلية، مع ترجمة قابلة للتشغيل والإيقاف في المشغّلات الداعمة.' : 'Save a new copy at the original video and audio quality, with subtitles you can switch on or off in supported players.'}</p>
            {error && <p className="dsm-error" role="alert">{error}</p>}
            <footer className="dsm-footer">{busy ? <><span className="dsm-busy" role="status"><LoaderCircle size={17} className="spin" />{ar ? 'جارٍ حفظ الفيديو…' : 'Saving video…'}</span><button type="button" className="dsm-secondary" onClick={() => void window.cortexDl.cancelDownloadSubtitleMerge(id)}>{ar ? 'إلغاء' : 'Cancel'}</button></>
              : <><button type="button" className="dsm-secondary" onClick={close}>{ar ? 'رجوع' : 'Back'}</button><button type="button" className="dsm-save" disabled={!files.some(file => file.fileName === selected)} onClick={() => void merge()}><Download size={17} />{ar ? `حفظ ${format.toUpperCase()} مع الترجمة` : `Save subtitled ${format.toUpperCase()}`}</button></>}</footer>
          </>}
      </div>
    </div>, document.body)}
  </>
}
