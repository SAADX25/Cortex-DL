import React, { useState, useMemo } from 'react'
import { Language, translations } from '../translations'
import { Youtube, Facebook, Instagram, Clapperboard, FolderPlus, Scissors } from 'lucide-react'
import AnimatedSegmentedControl from './AnimatedSegmentedControl'
import AdvancedTrimmer, { type TrimRange } from './AdvancedTrimmer'
import { useUIStore } from '../stores/useUIStore'


import UrlAnalysisView from './AddDownloadTab/UrlAnalysisView'
import PlaylistView from './AddDownloadTab/PlaylistView'
import BatchListView from './AddDownloadTab/BatchListView'

export type BatchItemStatus = 'pending' | 'processing' | 'success' | 'error'

export type BatchItem = {
  id: string
  url: string
  title?: string
  thumbnail?: string
  format: any
  loading?: boolean
  quality?: string | null
  subtitleLanguage?: string
  subtitleIsAutomatic?: boolean
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
  selectedSubtitleLanguage: string
  setSelectedSubtitleLanguage: (val: string) => void
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
  removeAnalyzedPlaylistVideo: (index: number) => void
  togglePlaylistItemSelected: (index: number) => void
  selectAllPlaylistItems: (indices?: number[]) => void
  deselectAllPlaylistItems: (indices?: number[]) => void
  clearPlaylistItems: () => void
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
  selectedSubtitleLanguage,
  setSelectedSubtitleLanguage,
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
  YouTubeMusicIcon,
  removeAnalyzedPlaylistVideo,
  togglePlaylistItemSelected,
  selectAllPlaylistItems,
  deselectAllPlaylistItems,
  clearPlaylistItems
}) => {
  const t = translations[lang]

  
  const url = useUIStore((s) => s.url)
  const setUrl = useUIStore((s) => s.setUrl)
  const directory = useUIStore((s) => s.directory)
  const batchItems = useUIStore((s) => s.batchItems)
  const setBatchItems = useUIStore((s) => s.setBatchItems)
  const globalError = useUIStore((s) => s.globalError)
  const analyzeResult = useUIStore((s) => s.analyzeResult)
  const analyzing = useUIStore((s) => s.analyzing)
  const showToast = useUIStore((s) => s.showToast)

  const [isTrimmerOpen, setIsTrimmerOpen] = useState(false)

  const trimmerSource = useMemo(() => {
    if (isAudioMode || analyzeResult?.kind !== 'ytdlp' || !analyzeResult.duration) return null

    const formatsWithUrls = analyzeResult.formats.filter((format) => Boolean(format.url))
    if (formatsWithUrls.length === 0) return null

    const selectedHeight = selectedQuality.endsWith('p')
      ? Number(selectedQuality.replace('p', ''))
      : null

    const candidates = selectedHeight
      ? formatsWithUrls.filter((format) => format.height === selectedHeight)
      : formatsWithUrls

    const sorted = [...(candidates.length > 0 ? candidates : formatsWithUrls)].sort((a, b) => {
      const aMuxed = a.description.includes('(Muxed)') ? 1 : 0
      const bMuxed = b.description.includes('(Muxed)') ? 1 : 0
      if (aMuxed !== bMuxed) return bMuxed - aMuxed

      const aMp4 = a.ext === 'mp4' ? 1 : 0
      const bMp4 = b.ext === 'mp4' ? 1 : 0
      if (aMp4 !== bMp4) return bMp4 - aMp4

      return (b.height ?? 0) - (a.height ?? 0)
    })

    return {
      videoUrl: sorted[0].url ?? '',
      duration: analyzeResult.duration,
    }
  }, [analyzeResult, isAudioMode, selectedQuality])

  const applyTrimRange = (range: TrimRange) => {
    setStartTime(range.startTime)
    setEndTime(range.endTime)
  }

  return (
    <div className="tab-content fade-in centered-layout flex flex-col h-full">
      <header className="content-header centered-header">
        <h1 className="gradient-text">{t.add_title}</h1>
        <p className="muted">{t.add_subtitle}</p>
      </header>

      <section className="minimal-panel">
        <div className="input-group">

          {}
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

          {}
          <div className="modern-chips-grid flex flex-row justify-between items-center w-full">
            {}
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
                  setSelectedSubtitleLanguage('')
                }}
              >
                {t.btn_audio}
              </button>
            </div>

            {}
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

          {}
          {analyzeResult && (
            <div className="fade-in">
              {}
              {analyzeResult.kind === 'playlist' ? (
                <PlaylistView
                  analyzeResult={analyzeResult}
                  lang={lang}
                  MAX_BATCH_ITEMS={MAX_BATCH_ITEMS}
                  SmartImage={SmartImage}
                  removeAnalyzedPlaylistVideo={removeAnalyzedPlaylistVideo}
                  togglePlaylistItemSelected={togglePlaylistItemSelected}
                  selectAllPlaylistItems={selectAllPlaylistItems}
                  deselectAllPlaylistItems={deselectAllPlaylistItems}
                  clearPlaylistItems={clearPlaylistItems}
                />
              ) : (
                <UrlAnalysisView
                  analyzeResult={analyzeResult}
                  url={url}
                  lang={lang}
                  SmartImage={SmartImage}
                  setCommentsSuccessPath={setCommentsSuccessPath}
                  setIsCommentsDownloading={setIsCommentsDownloading}
                  showToast={showToast}
                  isAudioMode={isAudioMode}
                  selectedSubtitleLanguage={selectedSubtitleLanguage}
                  setSelectedSubtitleLanguage={setSelectedSubtitleLanguage}
                />
              )}

              {}
              <div className="advanced-options">
                <div className="format-quality-row">
                  {}
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

                  {}
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

                {}
                {trimmerSource ? (
                  <>
                    <button
                      type="button"
                      className={`trimmer-toggle-btn${isTrimmerOpen ? ' trimmer-toggle-btn--active' : ''}`}
                      onClick={() => {
                        const next = !isTrimmerOpen
                        setIsTrimmerOpen(next)
                        if (!next) {
                          
                          setStartTime('')
                          setEndTime('')
                        }
                      }}
                    >
                      <Scissors size={15} />
                      <span>{isTrimmerOpen ? 'Close Trimmer' : 'Advanced Trim'}</span>
                    </button>

                    <div className={`trimmer-collapse${isTrimmerOpen ? ' trimmer-collapse--open' : ''}`}>
                      {isTrimmerOpen && (
                        <AdvancedTrimmer
                          key={trimmerSource.videoUrl}
                          videoUrl={trimmerSource.videoUrl}
                          originalUrl={url}
                          duration={trimmerSource.duration}
                          initialStartTime={startTime}
                          initialEndTime={endTime}
                          onChange={applyTrimRange}
                          onConfirm={(range) => {
                            applyTrimRange(range)
                            showToast(`Trim saved: ${range.startTime} - ${range.endTime}`)
                          }}
                        />
                      )}
                    </div>
                  </>
                ) : null}

                {}
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

              {}
              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button
                  className="download-main-btn-large"
                  style={{ 
                    flex: 1, 
                    opacity: analyzeResult?.kind === 'playlist' && (analyzeResult.items.filter((i:any) => i.selected).length > MAX_BATCH_ITEMS || analyzeResult.items.filter((i:any) => i.selected).length === 0) ? 0.4 : 1, 
                    cursor: analyzeResult?.kind === 'playlist' && (analyzeResult.items.filter((i:any) => i.selected).length > MAX_BATCH_ITEMS || analyzeResult.items.filter((i:any) => i.selected).length === 0) ? 'not-allowed' : 'pointer' 
                  }}
                  onClick={onDownloadNow}
                  disabled={analyzeResult?.kind === 'playlist' && (analyzeResult.items.filter((i:any) => i.selected).length > MAX_BATCH_ITEMS || analyzeResult.items.filter((i:any) => i.selected).length === 0)}
                >
                  🚀 Download Now
                </button>
                <button
                  style={{ 
                    flex: 1, 
                    padding: '14px 20px', 
                    borderRadius: 12, 
                    border: '1px solid rgba(255,255,255,0.12)', 
                    background: 'rgba(255,255,255,0.05)', 
                    color: '#d1d5db', 
                    fontWeight: 600, 
                    fontSize: 15, 
                    cursor: (batchItems.length >= MAX_BATCH_ITEMS || (analyzeResult?.kind === 'playlist' && (analyzeResult.items.filter((i:any) => i.selected).length > MAX_BATCH_ITEMS || analyzeResult.items.filter((i:any) => i.selected).length === 0))) ? 'not-allowed' : 'pointer', 
                    opacity: (batchItems.length >= MAX_BATCH_ITEMS || (analyzeResult?.kind === 'playlist' && (analyzeResult.items.filter((i:any) => i.selected).length > MAX_BATCH_ITEMS || analyzeResult.items.filter((i:any) => i.selected).length === 0))) ? 0.4 : 1, 
                    transition: 'background 0.2s' 
                  }}
                  onClick={onAddToList}
                  disabled={batchItems.length >= MAX_BATCH_ITEMS || (analyzeResult?.kind === 'playlist' && (analyzeResult.items.filter((i:any) => i.selected).length > MAX_BATCH_ITEMS || analyzeResult.items.filter((i:any) => i.selected).length === 0))}
                  onMouseEnter={(e) => { if (!(batchItems.length >= MAX_BATCH_ITEMS || (analyzeResult?.kind === 'playlist' && (analyzeResult.items.filter((i:any) => i.selected).length > MAX_BATCH_ITEMS || analyzeResult.items.filter((i:any) => i.selected).length === 0)))) e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                >
                  ➕ Add to Batch List
                </button>
              </div>
            </div>
          )}

          {}
          <div className="flex-1 overflow-y-auto pr-2">
            <BatchListView 
              batchItems={batchItems} 
              setBatchItems={setBatchItems} 
              SmartImage={SmartImage} 
            />
          </div>

        </div>

        {globalError ? <div className="global-error-banner">{globalError}</div> : null}
      </section>

      {}
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
          <button className="brand-icon-btn reddit" onClick={() => onOpenExternal('https://www.reddit.com')} title="Reddit">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 11.779c0-1.459-1.192-2.645-2.657-2.645-.715 0-1.363.286-1.84.746-1.81-1.191-4.259-1.949-6.971-2.046l1.483-4.669 4.016.941-.006.058c0 1.193.975 2.163 2.174 2.163 1.198 0 2.172-.97 2.172-2.163s-.975-2.164-2.172-2.164c-.92 0-1.704.574-2.021 1.379l-4.329-1.015c-.189-.046-.381.063-.44.249l-1.654 5.207c-2.838.034-5.409.798-7.3 2.025-.474-.438-1.103-.712-1.799-.712-1.465 0-2.656 1.187-2.656 2.646 0 .97.533 1.811 1.317 2.271-.052.282-.086.567-.086.857 0 3.911 4.808 7.093 10.719 7.093s10.72-3.182 10.72-7.093c0-.274-.029-.544-.075-.81.832-.447 1.405-1.312 1.405-2.318zm-17.224 1.816c0-.868.71-1.575 1.582-1.575.872 0 1.581.707 1.581 1.575s-.709 1.574-1.581 1.574-1.582-.706-1.582-1.574zm9.014 4.597c-.45.447-1.288.615-2.82.615-1.567 0-2.438-.179-2.884-.61-.219-.21-.216-.543-.006-.753.21-.21.543-.213.753-.002.112.107.515.228 2.128.228 1.636 0 2.036-.129 2.146-.238.209-.208.541-.205.748.006.208.21.21.542.001.751zm-.055-1.448c-.872 0-1.582-.705-1.582-1.574 0-.868.71-1.575 1.582-1.575.871 0 1.581.707 1.581 1.575s-.71 1.574-1.581 1.574z"/>
            </svg>
          </button>
          <button className="brand-icon-btn x" onClick={() => onOpenExternal('https://x.com')} title="X">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </button>
          <button className="brand-icon-btn tiktok" onClick={() => onOpenExternal('https://www.tiktok.com')} title="TikTok">
            <Clapperboard size={20} />
          </button>
          <button className="brand-icon-btn kick" onClick={() => onOpenExternal('https://kick.com')} title="Kick">
            {}
            <svg width="20" height="20" viewBox="0 0 200 200" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M30 20 H90 V80 H120 L150 20 H200 L160 100 L200 180 H150 L120 120 H90 V180 H30 V20Z" />
            </svg>
          </button>
        </div>
      </div>

    </div>
  )
}

export default AddDownloadTab
