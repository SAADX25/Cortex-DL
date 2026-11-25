// Subtitle cue review editor: timing offset, review filter, inline cue editing, pagination, and SRT/VTT/video export
import React from 'react'
import { Captions, CheckCircle2, Download, PencilLine, Play } from 'lucide-react'
import type { SubtitleCue, SubtitleDocument } from '../../../../Shared/localSubtitles'
import type { Translations } from '../../locales/types'

export interface SubtitleReviewPanelProps {
  t: Translations['subtitles']['studio']
  document: SubtitleDocument
  cues: SubtitleCue[]
  visible: SubtitleCue[]
  reviewed: number
  onlyReview: boolean
  offset: number
  valid: boolean
  pending: boolean
  localVideo: boolean
  pages: number
  currentPage: number
  onPlayPreview: () => void
  onEmbedVideo: () => void
  onSave: (format: 'srt' | 'vtt') => void
  onSelectOnlyReview: (onlyReview: boolean) => void
  onOffsetChange: (offset: number) => void
  onUpdateCue: (id: number, patch: Partial<SubtitleCue>) => void
  onPageChange: (page: number) => void
}

export const SubtitleReviewPanel: React.FC<SubtitleReviewPanelProps> = ({
  t,
  document,
  cues,
  visible,
  reviewed,
  onlyReview,
  offset,
  valid,
  pending,
  localVideo,
  pages,
  currentPage,
  onPlayPreview,
  onEmbedVideo,
  onSave,
  onSelectOnlyReview,
  onOffsetChange,
  onUpdateCue,
  onPageChange,
}) => (
  <div className="ss-card ss-review">
    <div className="ss-review-header">
      <div>
        <h2>
          <PencilLine size={19} />
          {t.review}
        </h2>
        <p>{t.reviewNote}</p>
        <small>
          {document.name} · {document.sourceLanguage} → {document.targetLanguage} · {cues.length}
        </small>
      </div>
      <div className="ss-export">
        {localVideo && (
          <button
            className="ss-button ss-play"
            disabled={pending || !valid}
            onClick={onPlayPreview}
          >
            <Play size={16} />
            {t.play}
          </button>
        )}
        {localVideo && (
          <button className="ss-button" disabled={pending || !valid} onClick={onEmbedVideo}>
            <Captions size={16} />
            {t.embed}
          </button>
        )}
        <button className="ss-button" disabled={pending || !valid} onClick={() => onSave('srt')}>
          <Download size={16} />
          {t.saveSrt}
        </button>
        <button className="ss-button" disabled={pending || !valid} onClick={() => onSave('vtt')}>
          <Download size={16} />
          {t.saveVtt}
        </button>
      </div>
    </div>
    <div className="ss-review-tools">
      <div className="ss-filter">
        <button aria-pressed={!onlyReview} onClick={() => onSelectOnlyReview(false)}>
          {t.all} <span>{cues.length}</span>
        </button>
        <button aria-pressed={onlyReview} onClick={() => onSelectOnlyReview(true)}>
          {t.onlyReview} <span>{reviewed}</span>
        </button>
      </div>
      <label>
        {t.offset}
        <input
          type="number"
          dir="ltr"
          step="0.1"
          value={offset}
          onChange={e => onOffsetChange(Number(e.target.value))}
        />
      </label>
    </div>
    {!valid && <p className="ss-warning">{t.invalid}</p>}
    <div className="ss-cues">
      {visible.slice(currentPage * 20, currentPage * 20 + 20).map(cue => (
        <article key={cue.id} className={`ss-cue ${cue.review ? 'needs-review' : ''}`}>
          <div className="ss-cue-timing">
            <span className="ss-cue-number">{cue.id}</span>
            <label>
              {t.startTime}
              <input
                type="number"
                step="0.01"
                min="0"
                dir="ltr"
                value={cue.start}
                onChange={e => onUpdateCue(cue.id, { start: Number(e.target.value) })}
              />
            </label>
            <label>
              {t.endTime}
              <input
                type="number"
                step="0.01"
                min="0"
                dir="ltr"
                value={cue.end}
                onChange={e => onUpdateCue(cue.id, { end: Number(e.target.value) })}
              />
            </label>
            {cue.review && (
              <button
                className="ss-reviewed"
                onClick={() => onUpdateCue(cue.id, { review: false })}
                title={t.markReviewed}
                aria-label={t.markReviewedAria}
              >
                <CheckCircle2 size={18} />
              </button>
            )}
          </div>
          {document.sourceLanguage !== document.targetLanguage && (
            <p className="ss-original" dir="auto" aria-label={t.originalText}>
              {cue.original}
            </p>
          )}
          <textarea
            dir="auto"
            aria-label={`${t.translatedText} ${cue.id}`}
            value={cue.text}
            rows={2}
            onChange={e => onUpdateCue(cue.id, { text: e.target.value.replace(/[\r\n]+/g, ' ') })}
          />
        </article>
      ))}
    </div>
    {!visible.length && <p className="ss-muted">{t.noReview}</p>}
    {pages > 1 && (
      <div className="ss-pagination">
        <button
          className="ss-button"
          disabled={!currentPage}
          onClick={() => onPageChange(currentPage - 1)}
        >
          {t.previous}
        </button>
        <span>
          {t.page} {currentPage + 1} / {pages}
        </span>
        <button
          className="ss-button"
          disabled={currentPage + 1 >= pages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          {t.next}
        </button>
      </div>
    )}
  </div>
)
