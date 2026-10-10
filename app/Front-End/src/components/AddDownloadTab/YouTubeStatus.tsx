import { useEffect, useRef, useState } from 'react'
import { Captions, MonitorPlay, RefreshCw } from 'lucide-react'
import { useUIStore } from '../../stores/useUIStore'
import { useFormStore } from '../../stores/useFormStore'
import { normalizeIpcError } from '../../lib/downloadHelpers'
import { translations, type Language } from '../../translations'
import { isYouTubeUrl } from '../../../../Shared/youtubeErrors'

export function YouTubeStatus({ url, lang }: { url: string; lang: Language }) {
  const result = useUIStore(s => s.analyzeResult)
  const [busy, setBusy] = useState<'formats' | 'captions' | null>(null)
  const request = useRef<string | null>(null)
  useEffect(() => { setBusy(null); return () => {
    if (request.current) void window.cortexDl.cancelAnalysis(request.current)
    request.current = null
  } }, [url])
  if (!isYouTubeUrl(url) || result?.kind !== 'ytdlp' || result.preview) return null
  const state = busy === 'captions' ? 'loading' : result.captionDiscovery?.state ?? 'unknown'
  const labels = lang === 'ar' ? {
    available: 'الترجمة متاحة', 'none-confirmed': 'لم يُبلغ YouTube عن ترجمة', restricted: 'الوصول إلى الترجمة مقيّد',
    'rate-limited': 'طلبات الترجمة مقيّدة مؤقتاً', unknown: 'تعذر التحقق من الترجمة', loading: 'جارٍ التحقق من الترجمة…',
  } : {
    available: 'Captions available', 'none-confirmed': 'No captions were reported', restricted: 'Caption access restricted',
    'rate-limited': 'Subtitle requests temporarily rate-limited', unknown: 'Captions could not be checked', loading: 'Checking captions…',
  }
  const refresh = async (mode: 'formats' | 'captions') => {
    const id = crypto.randomUUID()
    request.current = id; setBusy(mode)
    const owned = () => request.current === id && useUIStore.getState().url === url
    try {
      if (mode === 'captions') {
        const discovery = await window.cortexDl.refreshCaptions(url, id)
        if (!owned()) return
        const current = useUIStore.getState().analyzeResult
        if (current?.kind === 'ytdlp') useUIStore.getState().setAnalyzeResult({ ...current,
          captionDiscovery: discovery, subtitles: discovery.state === 'available' || discovery.state === 'none-confirmed' ? discovery.subtitles : current.subtitles })
        if (['available', 'none-confirmed'].includes(discovery.state)) {
          const form = useFormStore.getState()
          if (!discovery.subtitles.some(track => track.languageCode === form.selectedSubtitleLanguage)) form.setSelectedSubtitleLanguage('')
        }
      } else {
        const refreshed = await window.cortexDl.refreshFormats(url, id)
        if (!owned() || refreshed.kind !== 'ytdlp') return
        const current = useUIStore.getState().analyzeResult
        useUIStore.getState().setAnalyzeResult({ ...refreshed, subtitles: current?.kind === 'ytdlp' ? current.subtitles : refreshed.subtitles,
          captionDiscovery: current?.kind === 'ytdlp' ? current.captionDiscovery : refreshed.captionDiscovery })
        const form = useFormStore.getState()
        if (form.selectedQuality && !refreshed.formats.some(f => `${f.height}p` === form.selectedQuality)) {
          form.setSelectedQuality(''); form.setSelectedYtdlpFormatId(null)
        }
      }
    } catch (error) {
      if (owned()) useUIStore.getState().showToast(normalizeIpcError(error, translations[lang].analyze_failed, translations[lang]))
    } finally { if (request.current === id) { request.current = null; setBusy(null) } }
  }
  const formatLabel = lang === 'ar' ? 'تحديث الجودات المتاحة' : 'Refresh available qualities'
  const captionLabel = lang === 'ar' ? 'تحديث الترجمات المتاحة' : 'Refresh available captions'
  return <div className="youtube-status" role="status" style={{ color: '#9caec6', fontSize: '12px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', margin: '8px 0' }}>
    {result.qualityStatus === 'restricted' && <span>{lang === 'ar' ? 'قيّد YouTube بعض الصيغ' : 'YouTube restricted some formats'}</span>}
    {result.qualityStatus === 'limited' && <span>{lang === 'ar' ? 'الدقات الأعلى غير متاحة من هذا الاستخراج' : 'Higher resolutions unavailable from this extraction'}</span>}
    <span>{labels[state]}</span>
    <button type="button" className="youtube-refresh-button" title={formatLabel} aria-label={formatLabel} aria-busy={busy === 'formats'} disabled={!!busy} onClick={() => void refresh('formats')}>
      {busy === 'formats' ? <RefreshCw size={19} className="spin" aria-hidden="true" /> : <>
        <MonitorPlay size={21} aria-hidden="true" />
        <RefreshCw size={11} className="youtube-refresh-mark" aria-hidden="true" />
      </>}
    </button>
    <button type="button" className="youtube-refresh-button" title={captionLabel} aria-label={captionLabel} aria-busy={busy === 'captions'} disabled={!!busy} onClick={() => void refresh('captions')}>
      {busy === 'captions' ? <RefreshCw size={19} className="spin" aria-hidden="true" /> : <>
        <Captions size={21} aria-hidden="true" />
        <RefreshCw size={11} className="youtube-refresh-mark" aria-hidden="true" />
      </>}
    </button>
  </div>
}
