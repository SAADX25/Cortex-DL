// Step-by-step progress banner shown while yt-dlp/media analysis is in flight
import { useEffect, useState } from 'react'
import { Check, FileSearch, Layers3, Link2, Loader2, Search } from 'lucide-react'
import { translations, type Language } from '../../translations'
import { type AnalysisStage } from '../../lib/analysisSession'
import './AnalysisActivity.css'

export default function AnalysisActivity({ stage, lang }: { stage: AnalysisStage; lang: Language }) {
  const [startedAt] = useState(() => Date.now())
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  const copy = translations[lang].analysis
  const findingFormats = stage === 'formats'
  const title = findingFormats ? copy.findingFormats : copy.readingDetails
  const steps = [
    { label: copy.stepLink, Icon: Link2, state: 'done' },
    { label: copy.stepDetails, Icon: FileSearch, state: findingFormats ? 'done' : 'active' },
    { label: copy.stepFormats, Icon: Layers3, state: findingFormats ? 'active' : 'pending' },
  ]
  return (
    <div className="analysis-activity" data-analysis-activity dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="analysis-activity-heading">
        <div className="analysis-radar" aria-hidden="true"><span /><Search size={20} /></div>
        <div className="analysis-activity-copy">
          <p className="analysis-activity-title" role="status" aria-live="polite">{title}<span className="analysis-dots" aria-hidden="true"><i /><i /><i /></span></p>
          <p className="analysis-activity-caption">{copy.optionsCaption}</p>
        </div>
        <span className="analysis-elapsed" aria-hidden="true">{seconds}{copy.elapsedUnit}</span>
      </div>
      <ol className="analysis-steps" aria-label={copy.stagesLabel}>
        {steps.map(({ label, Icon, state }) => (
          <li key={label} className={`analysis-step analysis-step--${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            {state === 'done' ? <Check size={13} aria-hidden="true" /> : state === 'active' ? <Loader2 size={13} className="analysis-step-spinner" aria-hidden="true" /> : <Icon size={13} aria-hidden="true" />}
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <div className="analysis-scan-track" role="progressbar" aria-label={copy.linkAnalysis} aria-valuetext={title}><span /></div>
      {seconds >= 12 && <p className="analysis-wait-hint" role="status">{copy.slowSourceHint}</p>}
    </div>
  )
}
