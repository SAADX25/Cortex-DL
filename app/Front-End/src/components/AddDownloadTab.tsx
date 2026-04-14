import React from 'react'
import { Language, translations } from '../translations'
import { Youtube, Facebook, Instagram, Clapperboard, FolderPlus } from 'lucide-react'
import CustomDropdown from './CustomDropdown'
import AnimatedSegmentedControl from './AnimatedSegmentedControl'
import { useUIStore } from '../stores/useUIStore'

// Local or exported types needed
export type BatchItemStatus = 'pending' | 'processing' | 'success' | 'error'

export type BatchItem = {
  id: string
  url: string
  title?: string
  thumbnail?: string
  format: any
  loading?: boolean
  quality?: string | null
  status?: BatchItemStatus
  errorMessage?: string
}

interface AddDownloadTabProps {
  MAX_BATCH_ITEMS: number
  subfolderName: string
  setSubfolderName: (val: string) => void
  speedLimit: string
  setSpeedLimit: (val: string) => void
  targetFormat: any
  setTargetFormat: (val: any) => void
  isAudioMode: boolean
  setIsAudioMode: (val: boolean) => void
  selectedQuality: string
  setSelectedQuality: (val: string) => void
  selectedVariantUrl: string | null
  setSelectedVariantUrl: (val: string | null) => void
  startTime: string
  setStartTime: (val: string) => void
  endTime: string
  setEndTime: (val: string) => void
  availableVideoQualities: any[] | null
  setSelectedYtdlpFormatId: (val: string | null) => void
  setTargetResolution: (val: number | null) => void
  onPasteAndAnalyze: () => void
  handleAnalyzeUrlDirectly: (val: string) => void
  onPickFolder: () => void
  onDownloadNow: () => void
  onAddToList: () => void
  onStartBatchDownload: () => void
  onOpenExternal: (url: string) => void
  setCommentsSuccessPath: (val: string | null) => void
  setIsCommentsDownloading: (val: boolean) => void
  lang: Language
  SmartImage: React.FC<any>
  UrlInputBar: React.FC<any>
  variantLabel: (v: any, lang: Language) => string
  YouTubeMusicIcon: React.FC<any>
}

const AddDownloadTab: React.FC<AddDownloadTabProps> = ({
  MAX_BATCH_ITEMS,
  subfolderName,
  setSubfolderName,
  speedLimit,
  setSpeedLimit,
  targetFormat,
  setTargetFormat,
  isAudioMode,
  setIsAudioMode,
  selectedQuality,
  setSelectedQuality,
  selectedVariantUrl,
  setSelectedVariantUrl,
  startTime,
  setStartTime,
  endTime,
  setEndTime,
  availableVideoQualities,
  setSelectedYtdlpFormatId,
  setTargetResolution,
  onPasteAndAnalyze,
  handleAnalyzeUrlDirectly,
  onPickFolder,
  onDownloadNow,
  onAddToList,
  onStartBatchDownload,
  onOpenExternal,
  setCommentsSuccessPath,
  setIsCommentsDownloading,
  lang,
  SmartImage,
  UrlInputBar,
  variantLabel,
  YouTubeMusicIcon
}) => {
  const t = translations[lang]

  // Read from Zustand store directly — no prop drilling needed
  const url = useUIStore((s) => s.url)
  const setUrl = useUIStore((s) => s.setUrl)
  const directory = useUIStore((s) => s.directory)
  const batchItems = useUIStore((s) => s.batchItems)
  const setBatchItems = useUIStore((s) => s.setBatchItems)
  const globalError = useUIStore((s) => s.globalError)
  const analyzeResult = useUIStore((s) => s.analyzeResult)
  const analyzing = useUIStore((s) => s.analyzing)
  const showToast = useUIStore((s) => s.showToast)

  return (
    <div className="tab-content fade-in centered-layout flex flex-col h-full">
      <header className="content-header centered-header">
        <h1 className="gradient-text">{t.add_title}</h1>
        <p className="muted">{t.add_subtitle}</p>
      </header>

      <section className="minimal-panel">
        <div className="input-group">

          {/* STEP 1: URL Input */}
          <div className="w-full">
            <UrlInputBar
              analyzing={analyzing}
              batchCount={batchItems.length}
              maxBatchItems={MAX_BATCH_ITEMS}
              placeholderText={t.url_placeholder}
              pasteAndGoText={t.paste_and_go || 'Paste & Go'}
              onPasteAndAnalyze={onPasteAndAnalyze}
              onAnalyze={handleAnalyzeUrlDirectly}
              onClear={() => setUrl('')}
              initialUrl={url}
            />
          </div>

          {/* STEP 2: Global Settings Row */}
          <div className="modern-chips-grid flex flex-row justify-between items-center w-full">
            {/* Left: Media Type */}
            <div className="chip-group flex flex-row items-center gap-2">
              <button
                className={`modern-chip transition-all duration-300 ease-in-out transform hover:scale-105 hover:-translate-y-1 ${!isAudioMode ? 'chip-active-blue hover:shadow-[0_8px_30px_rgba(34,211,238,0.4)]' : ''}`}
                onClick={() => {
                  setIsAudioMode(false)
                  setTargetFormat('mp4')
                }}
              >
                {t.btn_video}
              </button>
              <button
                className={`modern-chip transition-all duration-300 ease-in-out transform hover:scale-105 hover:-translate-y-1 ${isAudioMode ? 'chip-active-purple hover:shadow-[0_8px_30px_rgba(168,85,247,0.4)]' : ''}`}
                onClick={() => {
                  setIsAudioMode(true)
                  setTargetFormat('mp3')
                }}
              >
                {t.btn_audio}
              </button>
            </div>

            {/* Right: Download Settings */}
            <div className="chip-group flex flex-row items-center gap-3">
              <div className="cortex-pill cursor-pointer" onClick={onPickFolder}>
                <span className="text-lg">📁</span>
                <span className="text-white text-sm font-medium">
                  {directory ? directory.split(/[\\/]/).pop() : t.save_to}
                </span>
              </div>

              <div className="cortex-pill">
                <FolderPlus size={16} className="text-cyan-400" />
                <input
                  className="cortex-pill-input"
                  placeholder={t.new_folder_placeholder}
                  value={subfolderName}
                  onChange={(e) => setSubfolderName(e.target.value)}
                />
              </div>

              <select
                className="speed-select h-[42px] rounded-full"
                value={speedLimit}
                onChange={(e) => {
                  setSpeedLimit(e.target.value)
                  localStorage.setItem('cortex-speed-limit', e.target.value)
                }}
                title="Download Speed Limit"
              >
                <option value="auto">⚡ {t.speed_auto}</option>
                <option value="1M">1 MB/s</option>
                <option value="10M">10 MB/s</option>
                <option value="50M">50 MB/s</option>
                <option value="100M">100 MB/s</option>
              </select>
            </div>
          </div>

          {/* STEP 3: Preview + Config + Actions */}
          {analyzeResult && (
            <div className="fade-in">
              {/* Preview Card */}
              {analyzeResult.kind === 'playlist' ? (
                <div className="playlist-preview">
                  <div className="playlist-header">
                    <h3>🎬 {t.playlist_title}: {analyzeResult.title}</h3>
                    <span className="badge">{analyzeResult.items.length} {t.items_count}</span>
                  </div>
                  <div className="playlist-items">
                    {analyzeResult.items.slice(0, 10).map((item: any) => (
                      <div key={item.id} className="playlist-item">
                        {item.thumbnail && <SmartImage src={item.thumbnail} alt="thumbnail" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: '4px' }} />}
                        <span title={item.title}>{item.title}</span>
                      </div>
                    ))}
                    {analyzeResult.items.length > 10 && (
                      <div className="playlist-more">+ {analyzeResult.items.length - 10} more...</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="video-preview-large" style={{ alignItems: 'stretch' }}>
                  {analyzeResult.kind === 'ytdlp' && analyzeResult.thumbnail && (
                    <SmartImage src={analyzeResult.thumbnail} alt="thumb" className="preview-thumb-large" />
                  )}
                  <div className="preview-info-large" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div className="preview-title-large" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: '8px' }}>
                      {analyzeResult.kind === 'ytdlp' ? analyzeResult.title : 'HLS Stream'}
                    </div>

                    {/* 👀 Views & Likes */}
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
                          </div>
                        </div>
                      )}

                    {/* 💬 Comments */}
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
              )}

              {/* Advanced Settings */}
              <div className="advanced-options">
                <div className="format-quality-row">
                  {/* Format Pills */}
                  <div className="option-box">
                    <label className="option-label">{t.format_label || 'File Format'}</label>
                    <div className="flex flex-wrap gap-2" style={{ padding: 6 }}>
                      <AnimatedSegmentedControl
                        wrap={true}
                        options={!isAudioMode
                          ? [
                              { value: 'mp4',  label: 'MP4'  },
                              { value: 'mkv',  label: 'MKV'  },
                              { value: 'avi',  label: 'AVI'  },
                              { value: 'mov',  label: 'MOV'  },
                              { value: 'webm', label: 'WEBM' },
                              { value: 'ogv',  label: 'OGV'  },
                              { value: 'm4v',  label: 'M4V'  },
                            ]
                          : [
                              { value: 'mp3',  label: 'MP3'  },
                              { value: 'wav',  label: 'WAV'  },
                              { value: 'm4a',  label: 'M4A'  },
                              { value: 'ogg',  label: 'OGG'  },
                              { value: 'flac', label: 'FLAC' },
                              { value: 'aac',  label: 'AAC'  },
                              { value: 'opus', label: 'OPUS' },
                              { value: 'wma',  label: 'WMA'  },
                            ]}
                        value={targetFormat}
                        onChange={(v) => setTargetFormat(v as any)}
                        size="md"
                      />
                    </div>
                  </div>

                  {/* Quality Dropdown (Video only) */}
                  {!isAudioMode && (
                    <div className="option-box">
                      <label className="option-label">{t.quality_label}</label>
                      <select
                        className="quality-select"
                        value={selectedQuality}
                        onChange={(e) => {
                          setSelectedQuality(e.target.value)
                          setSelectedYtdlpFormatId(e.target.value || null)
                          setTargetResolution(null)
                        }}
                      >
                        <option value="">{t.quality_best || 'Best Auto'}</option>
                        {availableVideoQualities && availableVideoQualities.length > 0 ? (
                          availableVideoQualities.map((q) => (
                            <option key={`${q.height}p`} value={`${q.height}p`}>
                              {q.height}p {q.fps > 0 ? `(${q.fps}fps)` : ''}
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="2160p">{t.quality_4k || '4K'}</option>
                            <option value="1440p">{t.quality_2k || '2K'}</option>
                            <option value="1080p">{t.quality_1080p || '1080p'}</option>
                            <option value="720p">{t.quality_720p || '720p'}</option>
                          </>
                        )}
                      </select>
                    </div>
                  )}
                </div>

                {/* Smart Time Trimming */}
                <div className="option-box time-trim-box">
                  <label className="option-label">✂️ Smart Time Trim (optional)</label>
                  <div className="time-trim-row">
                    <div className="time-trim-field">
                      <span className="time-trim-hint">Start</span>
                      <input
                        className="time-trim-input"
                        type="text"
                        placeholder="HH:MM:SS"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                      />
                    </div>
                    <span className="time-trim-sep">→</span>
                    <div className="time-trim-field">
                      <span className="time-trim-hint">End</span>
                      <input
                        className="time-trim-input"
                        type="text"
                        placeholder="HH:MM:SS"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* HLS variant selector */}
                {analyzeResult.kind === 'hls-master' && (
                  <div className="option-box">
                    <label className="option-label">{t.quality_label}</label>
                    <select
                      className="quality-select"
                      value={selectedVariantUrl ?? ''}
                      onChange={(e) => setSelectedVariantUrl(e.target.value)}
                    >
                      {analyzeResult.variants.map((v: any) => (
                        <option value={v.url} key={v.url}>{variantLabel(v, lang)}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Two Action Buttons */}
              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button
                  className="download-main-btn-large"
                  style={{ flex: 1 }}
                  onClick={onDownloadNow}
                >
                  🚀 Download Now
                </button>
                <button
                  style={{ flex: 1, padding: '14px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#d1d5db', fontWeight: 600, fontSize: 15, cursor: batchItems.length >= MAX_BATCH_ITEMS ? 'not-allowed' : 'pointer', opacity: batchItems.length >= MAX_BATCH_ITEMS ? 0.4 : 1, transition: 'background 0.2s' }}
                  onClick={onAddToList}
                  disabled={batchItems.length >= MAX_BATCH_ITEMS}
                  onMouseEnter={(e) => { if (batchItems.length < MAX_BATCH_ITEMS) e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                >
                  ➕ Add to Batch List
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Batch list */}
          <div className="flex-1 overflow-y-auto pr-2">
            {batchItems.length > 0 && (
              <div className="batch-list fade-in" style={{ marginTop: 12, borderRadius: 8, background: '#0b1220', padding: 8 }}>
                {batchItems.map((item, idx) => {
                  const isItemError = item.status === 'error'
                  const isItemProcessing = item.status === 'processing'
                  const isItemLocked = isItemProcessing || item.status === 'success'
                  return (
                    <div key={item.id} style={{
                      display: 'flex', flexDirection: 'column',
                      padding: '6px 8px',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      borderLeft: isItemError ? '3px solid #ef4444' : isItemProcessing ? '3px solid #3b82f6' : '3px solid transparent',
                      background: isItemError ? 'rgba(239, 68, 68, 0.06)' : isItemProcessing ? 'rgba(59, 130, 246, 0.04)' : 'transparent',
                      transition: 'all 0.3s ease',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', overflow: 'hidden' }}>
                          {isItemProcessing ? (
                            <div style={{ width: 56, height: 32, borderRadius: 6, background: '#081026', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <div className="spinner-sm" style={{ width: 16, height: 16, borderWidth: 2 }}></div>
                            </div>
                          ) : item.thumbnail ? (
                            <SmartImage src={item.thumbnail} alt="thumb" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: 6 }} />
                          ) : item.loading ? (
                            <div style={{ width: 56, height: 32, borderRadius: 6, background: '#081026', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>⏳</div>
                          ) : (
                            <div style={{ width: 56, height: 32, borderRadius: 6, background: '#081026', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isItemError ? '#f87171' : '#9ca3af' }}>
                              {isItemError ? '⚠️' : item.format === 'mp3' ? '🎵' : '🎬'}
                            </div>
                          )}
                          <div style={{ color: isItemError ? '#fca5a5' : '#d1d5db', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }} title={item.title || item.url}>
                            {item.title || (item.loading ? 'Loading...' : item.url)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {isItemProcessing ? (
                            <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>Adding…</span>
                          ) : (
                            <div style={{ minWidth: 92, display: 'flex', alignItems: 'center', opacity: isItemLocked ? 0.4 : 1, pointerEvents: isItemLocked ? 'none' : 'auto' }}>
                              <CustomDropdown
                                value={item.format}
                                onChange={(v) => setBatchItems(prev => prev.map(b => b.id === item.id ? { ...b, format: v as any } : b))}
                                groups={[
                                  { label: 'Video', options: [ { value: 'mp4', label: 'MP4' }, { value: 'mkv', label: 'MKV' }, { value: 'avi', label: 'AVI' }, { value: 'mov', label: 'MOV' }, { value: 'webm', label: 'WEBM' }, { value: 'ogv', label: 'OGV' }, { value: 'm4v', label: 'M4V' } ] },
                                  { label: 'Audio', options: [ { value: 'mp3', label: 'MP3' }, { value: 'wav', label: 'WAV' }, { value: 'm4a', label: 'M4A' }, { value: 'ogg', label: 'OGG' }, { value: 'flac', label: 'FLAC' }, { value: 'aac', label: 'AAC' }, { value: 'opus', label: 'OPUS' }, { value: 'wma', label: 'WMA' } ] }
                                ]}
                              />
                            </div>
                          )}
                          <button
                            className="batch-remove-btn"
                            onClick={() => setBatchItems(prev => prev.filter((_, i) => i !== idx))}
                            disabled={isItemProcessing}
                            style={{ opacity: isItemProcessing ? 0.3 : 1 }}
                          >✕</button>
                        </div>
                      </div>
                      {isItemError && item.errorMessage && (
                        <div style={{ fontSize: 11, color: '#f87171', marginTop: 4, paddingLeft: 64, lineHeight: 1.3 }}>
                          ⚠️ {item.errorMessage}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>

        {globalError ? <div className="global-error-banner">{globalError}</div> : null}
      </section>

      {/* Bottom Anchor: Start Batch Download */}
      <div className="w-full mt-auto pt-4 flex-none">
        <div className="w-full max-w-full mx-auto px-2">
          {(() => {
            const isBatchProcessing = batchItems.some(b => b.status === 'processing')
            const errorCount = batchItems.filter(b => b.status === 'error').length
            return (
              <button
                className="download-main-btn-large fade-in w-full"
                onClick={onStartBatchDownload}
                disabled={batchItems.length === 0 || isBatchProcessing}
                style={{ opacity: isBatchProcessing ? 0.7 : 1, position: 'relative' }}
              >
                {isBatchProcessing ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <div className="spinner-sm" style={{ width: 16, height: 16, borderWidth: 2 }}></div>
                    Processing Batch…
                  </span>
                ) : errorCount > 0 ? (
                  `Retry ${errorCount} Failed · Start Batch Download (${batchItems.length} / ${MAX_BATCH_ITEMS})`
                ) : (
                  `Start Batch Download (${batchItems.length} / ${MAX_BATCH_ITEMS} items)`
                )}
              </button>
            )
          })()}
        </div>
      </div>

      <div className="quick-access-bar-minimal">
        <div className="quick-access-buttons">
          <button className="brand-icon-btn youtube" onClick={() => onOpenExternal('https://www.youtube.com')} title="YouTube">
            <Youtube size={20} />
          </button>
          <button className="brand-icon-btn ytmusic" onClick={() => onOpenExternal('https://music.youtube.com/')} title="YouTube Music">
            <YouTubeMusicIcon size={22} />
          </button>
          <button className="brand-icon-btn facebook" onClick={() => onOpenExternal('https://www.facebook.com')} title="Facebook">
            <Facebook size={20} />
          </button>
          <button className="brand-icon-btn instagram" onClick={() => onOpenExternal('https://www.instagram.com')} title="Instagram">
            <Instagram size={20} />
          </button>
          <button className="brand-icon-btn x" onClick={() => onOpenExternal('https://x.com')} title="X">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </button>
          <button className="brand-icon-btn tiktok" onClick={() => onOpenExternal('https://www.tiktok.com')} title="TikTok">
            <Clapperboard size={20} />
          </button>
        </div>
      </div>

    </div>
  )
}

export default AddDownloadTab