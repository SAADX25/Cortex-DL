import React from 'react'
import { Language } from '../../translations'

interface UrlAnalysisViewProps {
  analyzeResult: any
  url: string
  lang: Language
  SmartImage: React.FC<any>
  setCommentsSuccessPath: (val: string | null) => void
  setIsCommentsDownloading: (val: boolean) => void
  showToast: (msg: string) => void
  isAudioMode: boolean
  selectedSubtitleLanguage: string
  setSelectedSubtitleLanguage: (val: string) => void
}

const UrlAnalysisView: React.FC<UrlAnalysisViewProps> = ({
  analyzeResult,
  url,
  lang,
  SmartImage,
  setCommentsSuccessPath,
  setIsCommentsDownloading,
  showToast,
  isAudioMode,
  selectedSubtitleLanguage,
  setSelectedSubtitleLanguage
}) => {
  if (!analyzeResult || analyzeResult.kind === 'playlist') return null

  return (
    <div className="video-preview-large" style={{ alignItems: 'stretch' }}>
      {analyzeResult.kind === 'ytdlp' && analyzeResult.thumbnail && (
        <SmartImage src={analyzeResult.thumbnail} alt="thumb" className="preview-thumb-large" />
      )}
      <div className="preview-info-large" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="preview-title-large" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: '8px' }}>
          {analyzeResult.kind === 'ytdlp' ? analyzeResult.title : 'HLS Stream'}
        </div>

        {}
        {analyzeResult.kind === 'ytdlp' && (
          <div className="preview-metadata">
            <div className="preview-metadata-row">
              {analyzeResult.views != null && (
                <div className="metadata-badge" title={lang === 'ar' ? 'المشاهدات' : 'Views'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  <span>{analyzeResult.views.toLocaleString()}</span>
                </div>
              )}
              {analyzeResult.duration != null && (
                <div className="metadata-badge" title={lang === 'ar' ? 'المدة' : 'Duration'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  <span>{
                    (() => {
                      const d = analyzeResult.duration as number;
                      const h = Math.floor(d / 3600);
                      const m = Math.floor((d % 3600) / 60);
                      const s = d % 60;
                      return h > 0 
                        ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
                        : `${m}:${s.toString().padStart(2, '0')}`;
                    })()
                  }</span>
                </div>
              )}
              {analyzeResult.likes != null && (
                <div className="metadata-badge" title={lang === 'ar' ? 'الإعجابات' : 'Likes'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                  <span>{analyzeResult.likes.toLocaleString()}</span>
                </div>
              )}
              {analyzeResult.dislikes != null && analyzeResult.dislikes > 0 && (
                <div className="metadata-badge" title={lang === 'ar' ? 'عدم الإعجاب' : 'Dislikes'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg>
                  <span>{analyzeResult.dislikes.toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="preview-metadata-row" style={{ marginTop: '2px' }}>
              {(url.includes('youtube.com') || url.includes('youtu.be')) && (
                <div 
                  className="metadata-badge" 
                  style={{ cursor: 'pointer', backgroundColor: '#3b82f6', color: '#fff', border: 'none' }}
                  title={lang === 'ar' ? 'تحميل جميع التعليقات بملف نصي' : 'Download all comments to text file'}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const res = await window.cortexDl.downloadComments(url);
                    if (typeof res === 'object' && res !== null) {
                      if (res.success) {
                        setCommentsSuccessPath(res.filePath || null);
                        showToast(lang === 'ar' ? 'تم حفظ التعليقات بنجاح!' : 'Comments saved successfully!');
                      } else {
                        setIsCommentsDownloading(false);
                        if (!res.canceled) showToast(lang === 'ar' ? 'حدث خطأ أثناء استخراج التعليقات.' : 'Failed to extract comments.');
                      }
                    } else if (res) {
                      setCommentsSuccessPath(null);
                      showToast(lang === 'ar' ? 'تم حفظ التعليقات بنجاح!' : 'Comments saved successfully!');
                    } else {
                      setIsCommentsDownloading(false);
                    }
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
                  <span>{lang === 'ar' ? 'تحميل التعليقات' : 'Save Comments'}</span>
                </div>
              )}
              {!isAudioMode && analyzeResult.subtitles?.length > 0 && (
                <label
                  className="metadata-badge subtitle-language-control"
                  title={lang === 'ar'
                    ? '\u0633\u064a\u062a\u0645 \u062f\u0645\u062c \u0627\u0644\u062a\u0631\u062c\u0645\u0629 \u0627\u0644\u0645\u062e\u062a\u0627\u0631\u0629 \u062f\u0627\u062e\u0644 \u0645\u0644\u0641 \u0627\u0644\u0641\u064a\u062f\u064a\u0648'
                    : 'The selected subtitles will be embedded in the video file'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
                  </svg>
                  <select
                    value={selectedSubtitleLanguage}
                    onChange={(event) => setSelectedSubtitleLanguage(event.target.value)}
                    aria-label={lang === 'ar' ? '\u0627\u062e\u062a\u064a\u0627\u0631 \u0644\u063a\u0629 \u0627\u0644\u062a\u0631\u062c\u0645\u0629' : 'Select subtitle language'}
                  >
                    <option value="">{lang === 'ar' ? '\u0628\u062f\u0648\u0646 \u062a\u0631\u062c\u0645\u0629' : 'No subtitles'}</option>
                    {analyzeResult.subtitles.map((track: any) => (
                      <option key={track.languageCode} value={track.languageCode}>
                        {track.name}{track.name !== track.languageCode ? ' (' + track.languageCode + ')' : ''}
                        {track.isAutomatic ? (lang === 'ar' ? ' - \u062a\u0644\u0642\u0627\u0626\u064a\u0629' : ' - Auto') : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        )}

        {}
        {analyzeResult.kind === 'ytdlp' && (url.includes('youtube.com') || url.includes('youtu.be')) && analyzeResult.comments && analyzeResult.comments.length > 0 && (
          <div className="preview-comments custom-scrollbar">
            <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#6b7280', fontWeight: 'bold', marginBottom: '8px' }}>
              💬 {lang === 'ar' ? 'تعليقات' : 'Comments'}
            </h4>
            <div className="comments-list">
              {analyzeResult.comments.map((comment: any, i: number) => (
                <div key={i} className="comment-item">
                  <div className="comment-header">
                    <span className="comment-author">{comment.author}</span>
                    <span className="comment-likes">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                      {comment.likeCount > 0 ? comment.likeCount.toLocaleString() : 0}
                    </span>
                  </div>
                  <p className="comment-text" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{comment.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default UrlAnalysisView
