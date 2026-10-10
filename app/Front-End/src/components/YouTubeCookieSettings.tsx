import { useState } from 'react'
import { Cookie, FileText, FolderOpen, ExternalLink, Trash2, CheckCircle2, AlertCircle, LoaderCircle } from 'lucide-react'
import { useLang, useSettingsStore } from '../stores/useSettingsStore'
import { translations } from '../translations'
import { getCookieStatusText } from '../lib/cookieStatus'
import './YouTubeCookieSettings.css'

export default function YouTubeCookieSettings() {
  const lang = useLang()
  const t = translations[lang]
  const filePath = useSettingsStore(state => state.cookieFilePath)
  const validation = useSettingsStore(state => state.cookieValidation)
  const selectFile = useSettingsStore(state => state.onSelectCookieFile)
  const clearFile = useSettingsStore(state => state.onClearCookieFile)
  const [busy, setBusy] = useState<'select' | 'clear' | null>(null)
  const fileName = filePath?.split(/[\\/]/).pop() || filePath
  const checked = !!filePath && validation?.filePath === filePath && validation.code === 'valid' && validation.valid
  const problem = !!validation && !validation.valid && validation.code !== 'cleared' && (validation.code !== 'missing' || !!filePath)
  const fileProblem = problem && validation?.filePath === filePath
  const run = async (action: 'select' | 'clear') => {
    setBusy(action)
    try { await (action === 'select' ? selectFile() : clearFile()) }
    finally { setBusy(null) }
  }

  return <section className="youtube-cookie-card" dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-labelledby="youtube-cookie-title" aria-busy={!!busy}>
    <div className="yc-heading">
      <div className="yc-icon"><Cookie size={23} strokeWidth={1.7} /></div>
      <div className="yc-heading-text">
        <div className="yc-title-row"><h3 id="youtube-cookie-title">{t.youtube_auth_title}</h3><span className="yc-optional">{t.youtube_auth_optional}</span></div>
        <p>{t.youtube_auth_desc}</p>
      </div>
    </div>

    <div className={`yc-file ${checked ? 'checked' : fileProblem ? 'problem' : ''}`}>
      <FileText size={23} className="yc-file-icon" aria-hidden="true" />
      <div className="yc-file-copy">
        <span className="yc-file-name" title={filePath ?? undefined} dir="auto">{fileName || t.youtube_auth_no_file}</span>
        <span className="yc-file-state">{checked ? <><CheckCircle2 size={12} />{t.youtube_auth_ready}</> : fileProblem ? <><AlertCircle size={12} />{t.youtube_auth_attention}</> : filePath ? t.youtube_auth_selected : t.youtube_auth_empty_hint}</span>
      </div>
      {filePath && <button type="button" className="yc-remove" disabled={!!busy} onClick={() => void run('clear')} title={t.youtube_auth_clear_btn} aria-label={t.youtube_auth_clear_btn}>
        {busy === 'clear' ? <LoaderCircle size={17} className="spin" /> : <Trash2 size={17} />}
      </button>}
    </div>

    <div className="yc-actions">
      <button type="button" id="select-cookie-file-btn" className="yc-select" disabled={!!busy} onClick={() => void run('select')}>
        {busy === 'select' ? <LoaderCircle size={16} className="spin" /> : <FolderOpen size={16} />}
        {filePath ? t.youtube_auth_replace_btn : t.youtube_auth_select_btn}
      </button>
      <button type="button" id="get-cookies-extension-btn" className="yc-extension" onClick={() => void window.cortexDl.openExternal('https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc?hl=en-US&utm_source=ext_sidebar')}>
        <ExternalLink size={14} />{t.youtube_auth_get_extension}
      </button>
    </div>

    {problem && validation && <p className="yc-validation error" role="status">
      <AlertCircle size={14} />{getCookieStatusText(t, validation)}
    </p>}
  </section>
}
