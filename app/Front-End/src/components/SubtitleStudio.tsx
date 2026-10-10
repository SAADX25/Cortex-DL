import { useEffect, useState } from 'react'
import { Captions, FolderOpen, Languages, Download, CheckCircle2, ShieldCheck, X, AlertCircle, Play, LoaderCircle, PencilLine } from 'lucide-react'
import { SUBTITLE_LANGUAGES, type SubtitleCue, type SubtitleLanguage, type SubtitleState, type SubtitleReadiness, type SpeechModel, type TranslationModel } from '../../../Shared/localSubtitles'
import { useLang } from '../stores/useSettingsStore'
import { useUIStore } from '../stores/useUIStore'
import { useSubtitleStudioStore } from '../stores/useSubtitleStudioStore'
import './SubtitleStudio.css'
import { serializeSubtitles } from '../../../Shared/subtitleCues'

const labels = {
  en: {
    title: 'Video subtitles', intro: 'Turn speech into timed captions. Translate and review them in one place.', local: 'On your device',
    source: 'Video or audio', placeholder: 'Paste a public video link, or choose a file', choose: 'Choose file', spoken: 'Spoken language', auto: 'Detect automatically', target: 'Subtitle language', original: 'Original language',
    accuracy: 'Speech recognition', accurate: 'Higher accuracy · Large v3', fast: 'Faster · Large v3 Turbo', translation: 'Translation quality', standard: 'Standard · 4B', quality: 'Higher quality · 12B', memory: '12B translation needs at least 24 GB RAM.',
    setup: 'Prepare local models', setupNote: 'Download once. Speech and text are processed on this computer.', download: 'Download selected models', ready: 'Models ready', start: 'Generate subtitles', cancel: 'Cancel', preparing: 'Preparing audio', transcribing: 'Recognizing speech and timing', translating: 'Translating captions', installing: 'Downloading and checking models', exporting: 'Saving subtitled video', embed: 'Save subtitled video', completed: 'Subtitles ready for review', canceled: 'Canceled',
    license: 'Model license', review: 'Review captions', reviewNote: 'Check names, dialect and highlighted captions before exporting.', saveSrt: 'Save SRT', saveVtt: 'Save VTT', play: 'Preview video', onlyReview: 'Needs review', all: 'All captions', originalText: 'Original speech', translatedText: 'Subtitle text', startTime: 'Start (seconds)', endTime: 'End (seconds)', offset: 'Timing adjustment (seconds)', page: 'Page', previous: 'Previous', next: 'Next', saved: 'Subtitles saved', invalid: 'Check caption timing: positive duration, chronological order, and no overlaps.', error: 'Could not complete subtitles',
    preparingHint: 'First use can take time while the model loads. Recognition speed depends on your computer.', noReview: 'No captions flagged for review.',
  },
  ar: {
    title: 'ترجمة الفيديو', intro: 'حوّل الكلام إلى ترجمة بتوقيت الصوت، وترجمها وراجعها من مكان واحد.', local: 'على جهازك',
    source: 'الفيديو أو الصوت', placeholder: 'الصق رابط فيديو عام أو اختر ملفًا', choose: 'اختيار ملف', spoken: 'لغة الكلام', auto: 'اكتشاف تلقائي', target: 'لغة الترجمة', original: 'لغة الكلام الأصلية',
    accuracy: 'التعرف على الكلام', accurate: 'دقة أعلى · Large v3', fast: 'أسرع · Large v3 Turbo', translation: 'جودة الترجمة', standard: 'قياسي · 4B', quality: 'جودة أعلى · 12B', memory: 'الترجمة بنموذج 12B تحتاج 24 GB RAM على الأقل.',
    setup: 'تجهيز النماذج المحلية', setupNote: 'تنزيل لمرة واحدة. تتم معالجة الصوت والنص على هذا الجهاز.', download: 'تنزيل النماذج المختارة', ready: 'النماذج جاهزة', start: 'إنشاء الترجمة', cancel: 'إلغاء', preparing: 'تجهيز الصوت', transcribing: 'التعرف على الكلام وتوقيته', translating: 'ترجمة النص', installing: 'تنزيل النماذج وفحصها', exporting: 'حفظ الفيديو مع الترجمة', embed: 'حفظ الفيديو مع الترجمة', completed: 'الترجمة جاهزة للمراجعة', canceled: 'تم الإلغاء',
    license: 'ترخيص النموذج', review: 'مراجعة الترجمة', reviewNote: 'راجع الأسماء واللهجة والمقاطع المعلّمة قبل التصدير.', saveSrt: 'حفظ SRT', saveVtt: 'حفظ VTT', play: 'معاينة الفيديو', onlyReview: 'تحتاج مراجعة', all: 'كل المقاطع', originalText: 'الكلام الأصلي', translatedText: 'نص الترجمة', startTime: 'البداية (ثوانٍ)', endTime: 'النهاية (ثوانٍ)', offset: 'ضبط توقيت الترجمة (ثوانٍ)', page: 'صفحة', previous: 'السابق', next: 'التالي', saved: 'تم حفظ الترجمة', invalid: 'راجع توقيت المقاطع: مدة موجبة، ترتيب زمني، ومن دون تداخل.', error: 'تعذر إكمال الترجمة',
    preparingHint: 'قد يستغرق تحميل النموذج وقتًا عند أول استخدام. سرعة التعرف على الكلام تعتمد على جهازك.', noReview: 'لا توجد مقاطع معلّمة للمراجعة.',
  },
}
function errorLabel(message: string, ar: boolean): string {
  const errors: Record<string, [string, string]> = {
    YOUTUBE_AUTH_REQUIRED: ['This video requires sign-in. Choose a local video file instead.', 'هذا الفيديو يتطلب تسجيل الدخول. اختر ملف فيديو من جهازك.'],
    YOUTUBE_NETWORK_ERROR: ['Could not reach the video provider. Check your connection.', 'تعذر الاتصال بمصدر الفيديو. تحقق من اتصال الإنترنت.'],
    YOUTUBE_RATE_LIMITED: ['The video provider limited requests. Wait before retrying.', 'مصدر الفيديو قيّد الطلبات مؤقتًا. انتظر قبل المحاولة.'],
    LOCAL_SUBTITLES_NOT_INSTALLED: ['Download the selected models first.', 'نزّل النماذج المختارة أولًا.'],
    LOCAL_SUBTITLES_MEMORY: ['Select the 4B translation model for this computer.', 'اختر نموذج الترجمة 4B لهذا الجهاز.'],
    LOCAL_SUBTITLES_DISK_SPACE: ['Not enough free disk space for the selected models or audio.', 'المساحة المتاحة لا تكفي للنماذج المختارة أو الصوت.'],
    LOCAL_SUBTITLES_WINDOWS_X64: ['Local models currently support Windows x64.', 'النماذج المحلية تدعم Windows x64 حاليًا.'],
    LOCAL_SUBTITLES_BUSY: ['Wait for the current operation or cancel it.', 'انتظر العملية الحالية أو ألغها.'],
  }
  return errors[message]?.[ar ? 1 : 0] ?? message
}
export default function SubtitleStudio() {
  const lang = useLang(), t = labels[lang], ar = lang === 'ar'
  const languageName = (code: string, fallback: string) => new Intl.DisplayNames([lang], { type: 'language' }).of(code) || fallback
  const source = useSubtitleStudioStore(s => s.source), setSource = useSubtitleStudioStore(s => s.setSource)
  const [spoken, setSpoken] = useState<SubtitleLanguage | 'auto'>('auto')
  const [target, setTarget] = useState<SubtitleLanguage | 'original'>('ar')
  const [speech, setSpeech] = useState<SpeechModel>('accurate'), [translation, setTranslation] = useState<TranslationModel>('standard')
  const [readiness, setReadiness] = useState<SubtitleReadiness | null>(null)
  const [state, setState] = useState<SubtitleState>({ id: '', stage: 'idle', progress: null })
  const [pending, setPending] = useState(false), [message, setMessage] = useState('')
  const [cues, setCues] = useState<SubtitleCue[]>([]), [offset, setOffset] = useState(0), [onlyReview, setOnlyReview] = useState(false), [page, setPage] = useState(0)
  const busy = ['installing', 'preparing', 'transcribing', 'translating', 'exporting'].includes(state.stage)
  const translated = target !== 'original' && target !== spoken
  const ready = !!readiness?.speech[speech] && (!translated || !!readiness?.translation[translation])
  const lowMemory = translated && translation === 'quality' && !!readiness && readiness.ramGB < 24
  useEffect(() => {
    let disposed = false
    void Promise.all([window.cortexDl.getLocalSubtitleReadiness(), window.cortexDl.getLocalSubtitleState()]).then(([models, current]) => {
      if (!disposed) { setReadiness(models); setState(current) }
    }).catch(error => { if (!disposed) setMessage(error instanceof Error ? error.message : String(error)) })
    return () => { disposed = true }
  }, [])
  useEffect(() => {
    if (!busy) return
    let disposed = false, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const current = await window.cortexDl.getLocalSubtitleState()
        if (disposed) return
        setState(current)
        if (['idle', 'ready', 'canceled', 'error'].includes(current.stage)) {
          const models = await window.cortexDl.getLocalSubtitleReadiness()
          if (!disposed) setReadiness(models)
        } else timer = setTimeout(poll, 700)
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
    try { await action() } catch (error) { setMessage(errorLabel(error instanceof Error ? error.message : String(error), ar)) }
    finally { setPending(false) }
  }
  const begin = (install: boolean) => void invoke(async () => {
    const id = install ? await window.cortexDl.installSubtitleModels(speech, translated ? translation : null)
      : await window.cortexDl.startLocalSubtitles({ source, sourceLanguage: spoken, targetLanguage: target, speechModel: speech, translationModel: translation })
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
    if (file) useUIStore.getState().showToast(t.saved)
  })
  return <section className="subtitle-studio custom-scrollbar" dir={ar ? 'rtl' : 'ltr'}>
    <header className="ss-header"><div><h1>{t.title}</h1><p>{t.intro}</p></div><span className="ss-local"><ShieldCheck size={16} />{t.local}</span></header>
    <div className="ss-card ss-source"><label htmlFor="ss-source"><Captions size={19} />{t.source}</label><div className="ss-input-row">
      <input id="ss-source" dir="ltr" value={source} onChange={event => setSource(event.target.value)} placeholder={t.placeholder} disabled={busy || pending} />
      <button className="ss-button ss-folder" disabled={busy || pending} onClick={() => void invoke(async () => { const file = await window.cortexDl.selectSubtitleMedia(); if (file) setSource(file) })}><FolderOpen size={17} />{t.choose}</button>
    </div><div className="ss-options">
      <label>{t.spoken}<select value={spoken} disabled={busy || pending} onChange={e => setSpoken(e.target.value as typeof spoken)}><option value="auto">{t.auto}</option>{Object.entries(SUBTITLE_LANGUAGES).map(([code, name]) => <option key={code} value={code}>{languageName(code, name)}</option>)}</select></label>
      <Languages className="ss-language-arrow" size={23} />
      <label>{t.target}<select value={target} disabled={busy || pending} onChange={e => setTarget(e.target.value as typeof target)}><option value="original">{t.original}</option>{Object.entries(SUBTITLE_LANGUAGES).map(([code, name]) => <option key={code} value={code}>{languageName(code, name)}</option>)}</select></label>
    </div><div className="ss-options ss-model-options">
      <label>{t.accuracy}<select value={speech} disabled={busy || pending} onChange={e => setSpeech(e.target.value as SpeechModel)}><option value="accurate">{t.accurate}</option><option value="fast">{t.fast}</option></select></label>
      {translated && <label>{t.translation}<select value={translation} disabled={busy || pending} onChange={e => setTranslation(e.target.value as TranslationModel)}><option value="standard">{t.standard}</option><option value="quality">{t.quality}</option></select></label>}
    </div>
    {lowMemory && <p className="ss-warning"><AlertCircle size={16} />{t.memory}</p>}
    <div className="ss-start-row"><button className="ss-button ss-primary" disabled={busy || pending || !ready || !source.trim() || lowMemory} onClick={() => begin(false)}><Captions size={18} />{t.start}</button>{ready && <span className="ss-ready"><CheckCircle2 size={15} />{t.ready}</span>}</div>
    </div>
    {!ready && <div className="ss-card ss-setup"><div><h2><Download size={19} />{t.setup}</h2><p>{t.setupNote}</p><small dir="ltr">{speech === 'accurate' ? 'Large v3 · 3.10 GB' : 'Large v3 Turbo · 574 MB'}{translated ? translation === 'standard' ? ' + TranslateGemma 4B · 2.49 GB' : ' + TranslateGemma 12B · 7.30 GB' : ''} + engines · 29 MB</small></div>
      <button className="ss-button" disabled={busy || pending || lowMemory || !readiness} onClick={() => begin(true)}><Download size={16} />{t.download}</button>
      {translated && <a href="https://ai.google.dev/gemma/terms" target="_blank" rel="noreferrer">{t.license}</a>}
    </div>}
    {busy && <div className="ss-card ss-operation" role="status" aria-live="polite"><div className="ss-operation-title"><LoaderCircle size={21} className="spin" /><strong>{t[state.stage as 'installing' | 'preparing' | 'transcribing' | 'translating' | 'exporting']}</strong><button className="ss-button ss-cancel" disabled={pending} onClick={() => void invoke(() => window.cortexDl.cancelLocalSubtitles(state.id))}><X size={16} />{t.cancel}</button></div>
      <div className={`ss-progress ${state.progress === null ? 'indeterminate' : ''}`} role="progressbar" aria-label={t.start} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress ?? undefined}><span style={{ width: state.progress === null ? '35%' : `${state.progress}%` }} /></div>
      <small>{state.progress === null ? t.preparingHint : `${Math.round(state.progress)}%`}{state.detail && state.detail !== 'ready' ? ` · ${state.detail}` : ''}</small>
    </div>}
    {(message || state.error) && <div className="ss-error" role="alert"><AlertCircle size={18} /><span>{message || errorLabel(state.error!, ar)}</span></div>}
    {state.stage === 'canceled' && <p className="ss-muted">{t.canceled}</p>}
    {document && !busy && <div className="ss-card ss-review"><div className="ss-review-header"><div><h2><PencilLine size={19} />{t.review}</h2><p>{t.reviewNote}</p><small>{document.name} · {document.sourceLanguage} → {document.targetLanguage} · {cues.length}</small></div><div className="ss-export">
      {localVideo && <button className="ss-button ss-play" disabled={pending || !valid} onClick={() => void invoke(async () => { useUIStore.getState().setMediaPlayerFile({ filePath: document.localFile!, title: document.name, subtitlePreview: { language: document.targetLanguage, vtt: serializeSubtitles(adjusted, document.duration, 'vtt') } }) })}><Play size={16} />{t.play}</button>}
      {localVideo && <button className="ss-button" disabled={pending || !valid} onClick={() => void invoke(async () => { const id = await window.cortexDl.embedLocalSubtitles(document.id, adjusted); if (id) setState({ id, stage: 'exporting', progress: null, document }) })}><Captions size={16} />{t.embed}</button>}
      <button className="ss-button" disabled={pending || !valid} onClick={() => save('srt')}><Download size={16} />{t.saveSrt}</button><button className="ss-button" disabled={pending || !valid} onClick={() => save('vtt')}><Download size={16} />{t.saveVtt}</button>
    </div></div><div className="ss-review-tools"><div className="ss-filter"><button aria-pressed={!onlyReview} onClick={() => { setOnlyReview(false); setPage(0) }}>{t.all} <span>{cues.length}</span></button><button aria-pressed={onlyReview} onClick={() => { setOnlyReview(true); setPage(0) }}>{t.onlyReview} <span>{reviewed}</span></button></div><label>{t.offset}<input type="number" dir="ltr" step="0.1" value={offset} onChange={e => setOffset(Number(e.target.value))} /></label></div>
      {!valid && <p className="ss-warning">{t.invalid}</p>}
      <div className="ss-cues">{visible.slice(currentPage * 20, currentPage * 20 + 20).map(cue => <article key={cue.id} className={`ss-cue ${cue.review ? 'needs-review' : ''}`}>
        <div className="ss-cue-timing"><span className="ss-cue-number">{cue.id}</span><label>{t.startTime}<input type="number" step="0.01" min="0" dir="ltr" value={cue.start} onChange={e => updateCue(cue.id, { start: Number(e.target.value) })} /></label><label>{t.endTime}<input type="number" step="0.01" min="0" dir="ltr" value={cue.end} onChange={e => updateCue(cue.id, { end: Number(e.target.value) })} /></label>{cue.review && <button className="ss-reviewed" onClick={() => updateCue(cue.id, { review: false })} title={ar ? 'تأكيد المراجعة' : 'Mark as reviewed'} aria-label={ar ? 'تأكيد مراجعة المقطع' : 'Mark caption reviewed'}><CheckCircle2 size={18} /></button>}</div>
        {document.sourceLanguage !== document.targetLanguage && <p className="ss-original" dir="auto" aria-label={t.originalText}>{cue.original}</p>}
        <textarea dir="auto" aria-label={`${t.translatedText} ${cue.id}`} value={cue.text} rows={2} onChange={e => updateCue(cue.id, { text: e.target.value.replace(/[\r\n]+/g, ' ') })} />
      </article>)}</div>
      {!visible.length && <p className="ss-muted">{t.noReview}</p>}
      {pages > 1 && <div className="ss-pagination"><button className="ss-button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t.previous}</button><span>{t.page} {currentPage + 1} / {pages}</span><button className="ss-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t.next}</button></div>}
    </div>}
  </section>
}
