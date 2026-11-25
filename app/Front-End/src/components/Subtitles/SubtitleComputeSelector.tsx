// Compute device selector (Auto GPU vs CPU) and live hardware acceleration status for Subtitle Studio
import React from 'react'
import { Check, CheckCircle2, CircuitBoard, Cpu, Zap } from 'lucide-react'
import type { SpeechModel, SubtitleReadiness } from '../../../../Shared/localSubtitles'
import type { Translations } from '../../locales/types'

export interface SubtitleComputeSelectorProps {
  t: Translations['subtitles']['studio']
  compute: 'auto' | 'cpu'
  speech: SpeechModel
  readiness: SubtitleReadiness | null
  gpuSelected: boolean
  cpuName: string | undefined
  cpuLabel: string
  disabled: boolean
  onChange: (value: 'auto' | 'cpu') => void
}

export const SubtitleComputeSelector: React.FC<SubtitleComputeSelectorProps> = ({
  t,
  compute,
  speech,
  readiness,
  gpuSelected,
  cpuName,
  cpuLabel,
  disabled,
  onChange,
}) => (
  <fieldset className="ss-compute-options" disabled={disabled}>
    <legend>{t.device}</legend>
    <div className="ss-device-choices">
      {(['auto', 'cpu'] as const).map(value => (
        <label key={value} className="ss-device-choice">
          <input
            type="radio"
            name="subtitle-compute"
            value={value}
            checked={compute === value}
            onChange={() => onChange(value)}
          />
          <span className="ss-device-icon">
            {value === 'auto' ? <Zap size={20} /> : <Cpu size={20} />}
          </span>
          <span className="ss-device-copy">
            <span className="ss-device-title">
              {value === 'auto' ? t.autoDevice : t.cpuDevice}
              {value === 'auto' && <span className="ss-device-recommended">{t.recommended}</span>}
            </span>
            <span className="ss-device-hint">{value === 'auto' ? t.autoHint : t.cpuHint}</span>
          </span>
          <span className="ss-device-check" aria-hidden="true">
            {compute === value && <Check size={12} />}
          </span>
        </label>
      ))}
    </div>
    <div className={`ss-device-status ${gpuSelected ? 'gpu-ready' : ''}`}>
      {gpuSelected ? <CircuitBoard size={19} /> : <Cpu size={19} />}
      <div>
        <strong dir={gpuSelected || cpuName ? 'ltr' : undefined}>
          {gpuSelected
            ? `GPU · ${readiness?.gpu?.name}`
            : !readiness && compute === 'auto'
              ? t.checkingDevice
              : cpuName || compute === 'cpu'
                ? cpuLabel
                : t.cpuAvailable}
        </strong>
        <p>
          {gpuSelected ? (
            speech === 'accurate' ? (
              <>
                <bdi className="ss-device-model">Large v3 Q5</bdi> · {t.gpuMemoryNote}
              </>
            ) : (
              t.autoHint
            )
          ) : compute === 'cpu' ? (
            t.cpuNote
          ) : (
            t.autoCpuNote
          )}
        </p>
      </div>
      {gpuSelected && (
        <span className="ss-device-badge">
          <CheckCircle2 size={13} />
          {t.gpuReady}
        </span>
      )}
    </div>
  </fieldset>
)
