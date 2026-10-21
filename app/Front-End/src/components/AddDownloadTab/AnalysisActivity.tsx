import { useEffect, useState } from 'react'
import { Check, FileSearch, Layers3, Link2, Loader2, Search } from 'lucide-react'
import { type Language } from '../../translations'
import { type AnalysisStage } from '../../lib/analysisSession'
import './AnalysisActivity.css'

export default function AnalysisActivity({ stage, lang }: { stage: AnalysisStage; lang: Language }) {
  const [startedAt] = useState(() => Date.now())
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  const ar = lang === 'ar'
  const findingFormats = stage === 'formats'
  const title = findingFormats
    ? ar ? 'جاري البحث عن الصيغ والجودات' : 'Finding formats & quality'
    : ar ? 'جاري قراءة تفاصيل الرابط' : 'Reading video details'
  const steps = [
    { label: ar ? 'الرابط' : 'Link', Icon: Link2, state: 'done' },
    { label: ar ? 'التفاصيل' : 'Details', Icon: FileSearch, state: findingFormats ? 'done' : 'active' },
    { label: ar ? 'الجودات' : 'Formats', Icon: Layers3, state: findingFormats ? 'active' : 'pending' },
  ]
  return (
    <div className="analysis-activity" data-analysis-activity dir={ar ? 'rtl' : 'ltr'}>
      <div className="analysis-activity-heading">
        <div className="analysis-radar" aria-hidden="true"><span /><Search size={20} /></div>
        <div className="analysis-activity-copy">
          <p className="analysis-activity-title" role="status" aria-live="polite">{title}<span className="analysis-dots" aria-hidden="true"><i /><i /><i /></span></p>
          <p className="analysis-activity-caption">{ar ? 'ستظهر الخيارات فور اكتمال التحليل' : 'Your options will appear as soon as analysis is complete'}</p>
        </div>
        <span className="analysis-elapsed" aria-hidden="true">{seconds}{ar ? 'ث' : 's'}</span>
      </div>
      <ol className="analysis-steps" aria-label={ar ? 'مراحل التحليل' : 'Analysis stages'}>
        {steps.map(({ label, Icon, state }) => (
          <li key={label} className={`analysis-step analysis-step--${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            {state === 'done' ? <Check size={13} aria-hidden="true" /> : state === 'active' ? <Loader2 size={13} className="analysis-step-spinner" aria-hidden="true" /> : <Icon size={13} aria-hidden="true" />}
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <div className="analysis-scan-track" role="progressbar" aria-label={ar ? 'تحليل الرابط' : 'Link analysis'} aria-valuetext={title}><span /></div>
      {seconds >= 12 && <p className="analysis-wait-hint" role="status">{ar ? 'ما زال التحليل مستمرًا، المصدر يستغرق وقتًا أطول للاستجابة.' : 'Still working. This source is taking a little longer to respond.'}</p>}
    </div>
  )
}
