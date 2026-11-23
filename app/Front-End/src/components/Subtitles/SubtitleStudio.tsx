// On-device speech-to-subtitle studio: model setup, GPU/CPU toggle, cue review, and SRT/VTT/video export
import { useEffect, useState } from 'react'
import { Captions, FolderOpen, Languages, Download, CheckCircle2, ShieldCheck, X, AlertCircle, Play, LoaderCircle, PencilLine, Trash2, Cpu, Zap, CircuitBoard, Check, Mic, Music, Info, ChevronDown } from 'lucide-react'
import { SUBTITLE_LANGUAGES, type SubtitleCue, type SubtitleLanguage, type SubtitleState, type SubtitleReadiness, type SpeechModel, type TranslationModel, type RecognitionMode } from '../../../../Shared/localSubtitles'
import { useLang } from '../../stores/useSettingsStore'
import { useUIStore } from '../../stores/useUIStore'
import { useSubtitleStudioStore } from '../../stores/useSubtitleStudioStore'
import { translations } from '../../translations'
import './SubtitleStudio.css'
import { serializeSubtitles } from '../../../../Shared/subtitleCues'
import SubtitleLanguageSelect from './SubtitleLanguageSelect'

export default function SubtitleStudio() {
  const lang = useLang(), t = translations[lang].subtitles.studio, ar = lang === 'ar'
  const errorLabel = (msg: string) => t.errors[msg] ?? msg
  const languageName = (code: string, fallback: string) => new Intl.DisplayNames([lang], { type: 'language' }).of(code) || fallback
  const source = useSubtitleStudioStore(s => s.source), setSource = useSubtitleStudioStore(s => s.setSource)
  const [spoken, setSpoken] = useState<SubtitleLanguage | 'auto'>('auto')
  const [target, setTarget] = useState<SubtitleLanguage | 'original'>('ar')
  const [speech, setSpeech] = useState<SpeechModel>('accurate'), [translation, setTranslation] = useState<TranslationModel>('standard')
  const [recognitionMode, setRecognitionMode] = useState<RecognitionMode>('speech')
  const [compute, setCompute] = useState<'auto' | 'cpu'>('auto')
  const [readiness, setReadiness] = useState<SubtitleReadiness | null>(null)
  const [state, setState] = useState<SubtitleState>({ id: '', stage: 'idle', progress: null })
  const [pending, setPending] = useState(false), [message, setMessage] = useState('')
  const [cues, setCues] = useState<SubtitleCue[]>([]), [offset, setOffset] = useState(0), [onlyReview, setOnlyReview] = useState(false), [page, setPage] = useState(0)
  const activeTab = useUIStore(s => s.activeTab)
  const busy = ['installing', 'preparing', 'transcribing', 'translating', 'exporting'].includes(state.stage)
  const translated = target !== 'original' && target !== spoken
  const ready = !!readiness?.speech[speech] && (!translated || !!readiness?.translation[translation])
  const lowMemory = translated && translation === 'quality' && !!readiness && readiness.ramGB < 24
  const gpuReady = !!readiness?.gpu?.speech[speech] && (!translated || !!readiness?.gpu?.translation)
  const gpuSelected = compute === 'auto' && gpuReady
  const cpuName = readiness?.cpu?.name?.trim()
  const cpuLabel = cpuName ? `CPU · ${cpuName}` : t.cpuDevice
  const detailLabel = state.detail === 'retrying-full-audio' ? t.retryingSpeech : state.detail === 'retrying-speech-timing' ? t.retryingTiming : state.detail === 'gpu-fallback' ? t.gpuFallback : state.detail === 'optimizing-gpu-model' ? t.optimizingGpu : state.detail
  const activeDevice = state.acceleration && ['transcribing', 'translating'].includes(state.stage) ? state.acceleration[state.stage === 'translating' ? 'translation' : 'speech'] : null
  useEffect(() => {
    let disposed = false
    void window.cortexDl.getLocalSubtitleState().then(current => {
      if (!disposed) setState(current)
    }).catch(error => { if (!disposed) setMessage(error instanceof Error ? error.message : String(error)) })
    return () => { disposed = true }
  }, [])
  useEffect(() => {
    if (busy) return
    let disposed = false, inFlight = false, refreshQueued = false, timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (disposed) return
      if (inFlight) { refreshQueued = true; return }
      inFlight = true
      clearTimeout(timer)
      try {
        const models = await window.cortexDl.getLocalSubtitleReadiness()
        if (!disposed) setReadiness(models)
      } catch (error) { if (!disposed) setMessage(error instanceof Error ? error.message : String(error)) }
      finally {
        inFlight = false
        if (!disposed && refreshQueued) { refreshQueued = false; void refresh() }
        else if (!disposed && activeTab === 'subtitles') timer = setTimeout(() => void refresh(), 5000)
      }
    }
    const focus = () => { if (activeTab === 'subtitles' && !window.document.hidden) void refresh() }
    void refresh()
    window.addEventListener('focus', focus)
    window.document.addEventListener('visibilitychange', focus)
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('focus', focus); window.document.removeEventListener('visibilitychange', focus) }
  }, [busy, state.id, activeTab])
  useEffect(() => {
    if (!busy) return
    let disposed = false, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const current = await window.cortexDl.getLocalSubtitleState()
        if (disposed) return
        setState(current)
        if (!['idle', 'ready', 'canceled', 'error'].includes(current.stage)) timer = setTimeout(poll, 700)
      } catch (error) { if (!disposed) { setMessage(error instanceof Error ? error.message : String(error)); timer = setTimeout(poll, 1500) } }
    }
    timer = setTimeout(poll, 250)
    return () => { disposed = true; clearTimeout(timer) }
  }, [busy, state.id])
  useEffect(() => {
    if (state.document && ['ready', 'error', 'canceled'].includes(state.stage)) { setCues(state.document.cues); setOffset(0); setPage(0); setOnlyReview(false) }
  }, [state.document, state.stage])
  const invoke = async (action: () => Promise<void>) => {
    setPending(true); setMessage('')
    try { await action() } catch (error) { setMessage(errorLabel(error instanceof Error ? error.message : String(error))) }
    finally { setPending(false) }
  }
  const begin = (install: boolean) => void invoke(async () => {
    const id = install ? await window.cortexDl.installSubtitleModels(speech, translated ? translation : null, compute)
      : await window.cortexDl.startLocalSubtitles({ source, sourceLanguage: spoken, targetLanguage: target, speechModel: speech, translationModel: translation, recognitionMode, compute })
    setState({ id, stage: install ? 'installing' : 'preparing', progress: null }); setCues([])
  })
  const document = state.document
  const localVideo = !!document?.localFile && /\.(?:mp4|mkv|webm|mov|avi|m4v|ogv)$/i.test(document.localFile)
  const adjusted = cues.map(cue => ({ ...cue, start: Math.round((cue.start + offset) * 1000) / 1000, end: Math.round((cue.end + offset) * 1000) / 1000 }))
  const valid = !!document && adjusted.length > 0 && adjusted.every((c, i) => c.text.trim() && Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start && c.end <= document.duration + 0.1 && (!i || c.start >= adjusted[i - 1].end - 0.001))
  const reviewed = cues.filter(cue => cue.review).length
  const visible = onlyReview ? cues.filter(cue => cue.review) : cues
  const pages = Math.max(1, Math.ceil(visible.length / 20)), currentPage = Math.min(page, pages - 1)
  const updateCue = (id: number, patch: Partial<SubtitleCue>) => setCues(old => old.map(cue => cue.id === id ? { ...cue, ...patch } : cue))
  const save = (format: 'srt' | 'vtt') => void invoke(async () => {
    const file = await window.cortexDl.exportLocalSubtitles(document!.id, adjusted, format)
    if (file) window.dispatchEvent(new Event('cortex:subtitle-files-changed'))
    if (file) useUIStore.getState().showToast(t.saved)
  })
  const clearSession = () => void invoke(async () => {
    const current = await window.cortexDl.clearLocalSubtitles(state.id)
    const ui = useUIStore.getState()
    if (ui.mediaPlayerFile?.subtitlePreview) ui.setMediaPlayerFile(null)
    setState(current); setSource(''); setCues([]); setOffset(0); setOnlyReview(false); setPage(0)
    ui.showToast(t.cleared)
  })
  return <section className="subtitle-studio custom-scrollbar" dir={ar ? 'rtl' : 'ltr'}>
    <header className="ss-header"><div><h1>{t.title}</h1><p>{t.intro}</p></div><span className="ss-local"><ShieldCheck size={16} />{t.local}</span></header>
    <div className="ss-session"><div><ShieldCheck size={18} /><div><strong>{t.session}</strong><p>{t.sessionNote}</p></div></div>{(source || state.id) && <button className="ss-button ss-clear" disabled={busy || pending} onClick={clearSession}><Trash2 size={16} />{t.clear}</button>}</div>
    <div className="ss-card ss-source"><label htmlFor="ss-source"><Captions size={19} />{t.source}</label><div className="ss-input-row">
      <input id="ss-source" dir="ltr" value={source} onChange={event => setSource(event.target.value)} placeholder={t.placeholder} disabled={busy || pending} />
      <button className="ss-button ss-folder" disabled={busy || pending} onClick={() => void invoke(async () => { const file = await window.cortexDl.selectSubtitleMedia(); if (file) setSource(file) })}><FolderOpen size={17} />{t.choose}</button>
    </div><div className="ss-options">
      <SubtitleLanguageSelect label={t.spoken} lang={lang} value={spoken} disabled={busy || pending} onChange={value => setSpoken(value as typeof spoken)} options={[{ value: 'auto', label: t.auto }, ...Object.entries(SUBTITLE_LANGUAGES).map(([code, name]) => ({ value: code, label: languageName(code, name), keywords: name }))]} />
      <Languages className="ss-language-arrow" size={23} />
      <SubtitleLanguageSelect label={t.target} lang={lang} value={target} disabled={busy || pending} onChange={value => setTarget(value as typeof target)} options={[{ value: 'original', label: t.original }, ...Object.entries(SUBTITLE_LANGUAGES).map(([code, name]) => ({ value: code, label: languageName(code, name), keywords: name }))]} />
    </div><div className="ss-options ss-model-options">
      <label>{t.accuracy}<select value={speech} disabled={busy || pending} onChange={e => setSpeech(e.target.value as SpeechModel)}><option value="accurate">{t.accurate}</option><option value="fast">{t.fast}</option></select></label>
      {translated && <label>{t.translation}<select value={translation} disabled={busy || pending} onChange={e => setTranslation(e.target.value as TranslationModel)}><option value="standard">{t.standard}</option><option value="quality">{t.quality}</option></select></label>}
    </div><div className="ss-options ss-content-options">
      <label htmlFor="ss-audio-content">{t.content}</label>
      <div className="ss-audio-picker">
        {recognitionMode === 'music' ? <Music size={18} className="ss-audio-icon" aria-hidden="true" /> : <Mic size={18} className="ss-audio-icon" aria-hidden="true" />}
        <select id="ss-audio-content" aria-describedby="ss-audio-hint" value={recognitionMode} disabled={busy || pending} onChange={e => setRecognitionMode(e.target.value as RecognitionMode)}><option value="speech">{t.speechContent}</option><option value="music">{t.musicContent}</option></select>
        <ChevronDown size={16} className="ss-audio-chevron" aria-hidden="true" />
      </div>
      <p id="ss-audio-hint" className="ss-audio-hint"><Info size={14} aria-hidden="true" /><span>{recognitionMode === 'music' ? t.musicHint : t.speechHint}</span></p>
    </div>
    <fieldset className="ss-compute-options" disabled={busy || pending}>
      <legend>{t.device}</legend>
      <div className="ss-device-choices">
        {(['auto', 'cpu'] as const).map(value => <label key={value} className="ss-device-choice">
          <input type="radio" name="subtitle-compute" value={value} checked={compute === value} onChange={() => setCompute(value)} />
          <span className="ss-device-icon">{value === 'auto' ? <Zap size={20} /> : <Cpu size={20} />}</span>
          <span className="ss-device-copy"><span className="ss-device-title">{value === 'auto' ? t.autoDevice : t.cpuDevice}{value === 'auto' && <span className="ss-device-recommended">{t.recommended}</span>}</span><span className="ss-device-hint">{value === 'auto' ? t.autoHint : t.cpuHint}</span></span>
          <span className="ss-device-check" aria-hidden="true">{compute === value && <Check size={12} />}</span>
        </label>)}
      </div>
      <div className={`ss-device-status ${gpuSelected ? 'gpu-ready' : ''}`}>
        {gpuSelected ? <CircuitBoard size={19} /> : <Cpu size={19} />}
        <div><strong dir={gpuSelected || cpuName ? 'ltr' : undefined}>{gpuSelected ? `GPU · ${readiness?.gpu?.name}` : !readiness && compute === 'auto' ? t.checkingDevice : cpuName || compute === 'cpu' ? cpuLabel : t.cpuAvailable}</strong><p>{gpuSelected ? speech === 'accurate' ? <><bdi className="ss-device-model">Large v3 Q5</bdi> · {t.gpuMemoryNote}</> : t.autoHint : compute === 'cpu' ? t.cpuNote : t.autoCpuNote}</p></div>
        {gpuSelected && <span className="ss-device-badge"><CheckCircle2 size={13} />{t.gpuReady}</span>}
      </div>
    </fieldset>
    {lowMemory && <p className="ss-warning"><AlertCircle size={16} />{t.memory}</p>}
    <div className="ss-start-row"><button className="ss-button ss-primary" disabled={busy || pending || !ready || !source.trim() || lowMemory} onClick={() => begin(false)}><Captions size={18} />{t.start}</button>{ready && <span className="ss-ready"><CheckCircle2 size={15} />{t.ready}</span>}</div>
    </div>
    {!ready && <div className="ss-card ss-setup"><div><h2><Download size={19} />{t.setup}</h2><p>{t.setupNote}</p><small dir="ltr">{speech === 'accurate' ? 'Large v3 · 3.10 GB' : 'Large v3 Turbo · 574 MB'}{translated ? translation === 'standard' ? ' + TranslateGemma 4B · 2.49 GB' : ' + TranslateGemma 12B · 7.30 GB' : ''} + engines · 29 MB</small></div>
      <button className="ss-button" disabled={busy || pending || lowMemory || !readiness} onClick={() => begin(true)}><Download size={16} />{t.download}</button>
      {translated && <a href="https://ai.google.dev/gemma/terms" target="_blank" rel="noreferrer">{t.license}</a>}
    </div>}
    {ready && readiness?.gpu && compute === 'auto' && !gpuReady && <div className="ss-card ss-setup ss-gpu-setup"><div><h2><ShieldCheck size={19} />{t.gpuSetup}</h2><p>{t.gpuNote}</p><small>{readiness.gpu.name} · {Math.round(readiness.gpu.memoryMB / 1024)} GB</small></div><button className="ss-button" disabled={busy || pending || lowMemory} onClick={() => begin(true)}><Download size={16} />{t.gpuDownload}</button></div>}
    {busy && <div className="ss-card ss-operation" role="status" aria-live="polite"><div className="ss-operation-title"><LoaderCircle size={21} className="spin" /><strong>{t[state.stage as 'installing' | 'preparing' | 'transcribing' | 'translating' | 'exporting']}</strong><button className="ss-button ss-cancel" disabled={pending} onClick={() => void invoke(() => window.cortexDl.cancelLocalSubtitles(state.id))}><X size={16} />{t.cancel}</button></div>
      <div className={`ss-progress ${state.progress === null ? 'indeterminate' : ''}`} role="progressbar" aria-label={t.start} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress ?? undefined}><span style={{ width: state.progress === null ? '35%' : `${state.progress}%` }} /></div>
      {activeDevice && <small className="ss-active-device"><bdi>{activeDevice === 'gpu' ? `GPU · ${state.acceleration?.device}` : cpuLabel}</bdi>{state.stage === 'transcribing' && state.acceleration?.compact ? ` · ${t.gpuCompact}` : ''}</small>}
      <small>{state.progress === null ? t.preparingHint : `${Math.round(state.progress)}%`}{state.detail && state.detail !== 'ready' ? ` · ${detailLabel}` : ''}</small>
    </div>}
    {(message || state.error) && <div className="ss-error" role="alert"><AlertCircle size={18} /><span>{message || errorLabel(state.error!)}</span></div>}
    {state.stage === 'canceled' && <p className="ss-muted">{t.canceled}</p>}
    {document && !busy && <div className="ss-card ss-review"><div className="ss-review-header"><div><h2><PencilLine size={19} />{t.review}</h2><p>{t.reviewNote}</p><small>{document.name} · {document.sourceLanguage} → {document.targetLanguage} · {cues.length}</small></div><div className="ss-export">
      {localVideo && <button className="ss-button ss-play" disabled={pending || !valid} onClick={() => void invoke(async () => { useUIStore.getState().setMediaPlayerFile({ filePath: document.localFile!, title: document.name, subtitlePreview: { language: document.targetLanguage, vtt: serializeSubtitles(adjusted, document.duration, 'vtt') } }) })}><Play size={16} />{t.play}</button>}
      {localVideo && <button className="ss-button" disabled={pending || !valid} onClick={() => void invoke(async () => { const id = await window.cortexDl.embedLocalSubtitles(document.id, adjusted); if (id) setState({ id, stage: 'exporting', progress: null, document }) })}><Captions size={16} />{t.embed}</button>}
      <button className="ss-button" disabled={pending || !valid} onClick={() => save('srt')}><Download size={16} />{t.saveSrt}</button><button className="ss-button" disabled={pending || !valid} onClick={() => save('vtt')}><Download size={16} />{t.saveVtt}</button>
    </div></div><div className="ss-review-tools"><div className="ss-filter"><button aria-pressed={!onlyReview} onClick={() => { setOnlyReview(false); setPage(0) }}>{t.all} <span>{cues.length}</span></button><button aria-pressed={onlyReview} onClick={() => { setOnlyReview(true); setPage(0) }}>{t.onlyReview} <span>{reviewed}</span></button></div><label>{t.offset}<input type="number" dir="ltr" step="0.1" value={offset} onChange={e => setOffset(Number(e.target.value))} /></label></div>
      {!valid && <p className="ss-warning">{t.invalid}</p>}
      <div className="ss-cues">{visible.slice(currentPage * 20, currentPage * 20 + 20).map(cue => <article key={cue.id} className={`ss-cue ${cue.review ? 'needs-review' : ''}`}>
        <div className="ss-cue-timing"><span className="ss-cue-number">{cue.id}</span><label>{t.startTime}<input type="number" step="0.01" min="0" dir="ltr" value={cue.start} onChange={e => updateCue(cue.id, { start: Number(e.target.value) })} /></label><label>{t.endTime}<input type="number" step="0.01" min="0" dir="ltr" value={cue.end} onChange={e => updateCue(cue.id, { end: Number(e.target.value) })} /></label>{cue.review && <button className="ss-reviewed" onClick={() => updateCue(cue.id, { review: false })} title={t.markReviewed} aria-label={t.markReviewedAria}><CheckCircle2 size={18} /></button>}</div>
        {document.sourceLanguage !== document.targetLanguage && <p className="ss-original" dir="auto" aria-label={t.originalText}>{cue.original}</p>}
        <textarea dir="auto" aria-label={`${t.translatedText} ${cue.id}`} value={cue.text} rows={2} onChange={e => updateCue(cue.id, { text: e.target.value.replace(/[\r\n]+/g, ' ') })} />
      </article>)}</div>
      {!visible.length && <p className="ss-muted">{t.noReview}</p>}
      {pages > 1 && <div className="ss-pagination"><button className="ss-button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t.previous}</button><span>{t.page} {currentPage + 1} / {pages}</span><button className="ss-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t.next}</button></div>}
    </div>}
  </section>
}
