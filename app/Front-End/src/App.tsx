/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  App.tsx — View layer for Cortex DL.
 *
 *  Responsibilities:
 *  ─ Calls useAppController for actions and local state
 *  ─ Renders SmartImage, UrlInputBar, and other presentational pieces
 *  ─ Distributes ONLY the props that aren't already in the Zustand store
 *  ─ Contains NO business logic or direct IPC calls
 *
 *  Global UI state (activeTab, directory, batchItems, globalError, url,
 *  analyzeResult, analyzing, toast) lives in useUIStore. Child components
 *  subscribe directly via selectors — no prop drilling.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useState, useEffect } from 'react'
import { X, ClipboardPaste } from 'lucide-react'
import './App.css'
import ConfirmModal from './ConfirmModal'
import MediaPlayerModal from './MediaPlayerModal'
import DownloadList from './components/DownloadList'
import Sidebar from './components/Sidebar'
import SettingsTab from './components/SettingsTab'
import AddDownloadTab from './components/AddDownloadTab'
import { useAppController, variantLabel } from './hooks/useAppController'
import { useUIStore } from './stores/useUIStore'
import React from 'react'

// ─── Presentational Components (no IPC, no complex logic) ────────────────────

export const YouTubeMusicIcon = ({ size = 22, ...props }: { size?: number } & any) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* White Hollow Ring */}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      {/* White Play Triangle */}
      <path d="M10.5 8.5 L15.5 12 L10.5 15.5 Z" fill="currentColor" />
    </svg>
  )
}

export const UrlInputBar = React.memo(({
  analyzing,
  batchCount,
  maxBatchItems,
  placeholderText,
  pasteAndGoText,
  onPasteAndAnalyze,
  onAnalyze,
  onClear,
  initialUrl = ''
}: {
  analyzing: boolean
  batchCount: number
  maxBatchItems: number
  placeholderText: string
  pasteAndGoText: string
  onPasteAndAnalyze: () => void
  onAnalyze: (url: string) => void
  onClear: () => void
  initialUrl: string
}) => {
  const [localUrl, setLocalUrl] = useState(initialUrl)

  useEffect(() => {
    setLocalUrl(initialUrl)
  }, [initialUrl])

  return (
    <div className="hero-input-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
      <input
        className="hero-input"
        value={localUrl}
        onChange={(e) => setLocalUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && localUrl.trim() && !analyzing) onAnalyze(localUrl) }}
        placeholder={batchCount >= maxBatchItems ? `Batch full (${maxBatchItems}/${maxBatchItems}). Start download to clear.` : placeholderText}
        dir="auto"
      />
      {localUrl && (
        <button className="hero-clear-btn" onClick={() => { setLocalUrl(''); onClear(); }}>
          <X size={20} />
        </button>
      )}
      <button
        className="hero-action-btn"
        onClick={localUrl.trim().length === 0 ? onPasteAndAnalyze : () => onAnalyze(localUrl)}
        disabled={analyzing}
      >
        {analyzing ? (
          <div className="spinner-sm"></div>
        ) : localUrl.trim().length === 0 ? (
          <>
            <ClipboardPaste size={20} />
            <span>{pasteAndGoText}</span>
          </>
        ) : (
          <>
            <span>🔍</span>
            <span>Analyze</span>
          </>
        )}
      </button>
    </div>
  )
})

// ─── Thumbnail fallback ──────────────────────────────────────────────────────

const THUMB_FALLBACK_DATA_URI = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='90'><rect width='100%' height='100%' fill='%23081126'/><text x='50%' y='50%' font-size='12' fill='%239ca3af' dominant-baseline='middle' text-anchor='middle'>No image</text></svg>"

// ─── SmartImage (needs thumbPort from the controller) ────────────────────────

function createSmartImage(thumbPort: number) {
  return function SmartImage({ src, alt, className, style, ...rest }: any) {
    const [imgSrc, setImgSrc] = useState<string | undefined>(src)
    useEffect(() => {
      let cancelled = false
      setImgSrc(src)
      if (src && /instagram|cdninstagram/i.test(src)) {
        ;(async () => {
          try {
            const filePath = await window.cortexDl.fetchThumbnail(src)
            if (!cancelled && filePath) {
              const streamUrl = `http://127.0.0.1:${thumbPort}/?path=${encodeURIComponent(filePath)}`
              setImgSrc(streamUrl)
            }
          } catch (err) {
            // fall back to original src; onError will handle visuals
          }
        })()
      }
      return () => { cancelled = true }
    }, [src])

    return (
      // eslint-disable-next-line jsx-a11y/alt-text
      <img
        src={imgSrc || THUMB_FALLBACK_DATA_URI}
        alt={alt || ''}
        className={className}
        style={style}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(e: any) => { e.currentTarget.onerror = null; e.currentTarget.src = THUMB_FALLBACK_DATA_URI }}
        {...rest}
      />
    )
  }
}

// ─── App Component ───────────────────────────────────────────────────────────

function App() {
  const ctrl = useAppController()
  const lang = ctrl.lang

  // Read from Zustand store — only the slices App.tsx itself needs for rendering
  const activeTab = useUIStore((s) => s.activeTab)
  const toastMsg = useUIStore((s) => s.toastMsg)

  // Memoize SmartImage so it doesn't re-create on every render
  const SmartImage = React.useMemo(() => createSmartImage(ctrl.thumbPort), [ctrl.thumbPort])

  return (
    <div className="app-container" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Sidebar 
        enginesStatus={ctrl.enginesStatus}
        lang={lang}
      />

      <main className="main-content">
        {/* Transient toast */}
        {toastMsg && (
          <div style={{ position: 'fixed', right: 20, top: 20, background: 'rgba(15,23,42,0.95)', color: '#fff', padding: '10px 14px', borderRadius: 10, boxShadow: '0 8px 30px rgba(2,6,23,0.6)', zIndex: 1000 }}>
            {toastMsg}
          </div>
        )}
        {activeTab === 'add' && (
          <AddDownloadTab 
            MAX_BATCH_ITEMS={ctrl.MAX_BATCH_ITEMS}
            subfolderName={ctrl.subfolderName} setSubfolderName={ctrl.setSubfolderName}
            speedLimit={ctrl.speedLimit} setSpeedLimit={ctrl.setSpeedLimit}
            targetFormat={ctrl.targetFormat} setTargetFormat={ctrl.setTargetFormat}
            isAudioMode={ctrl.isAudioMode} setIsAudioMode={ctrl.setIsAudioMode}
            selectedQuality={ctrl.selectedQuality} setSelectedQuality={ctrl.setSelectedQuality}
            selectedVariantUrl={ctrl.selectedVariantUrl} setSelectedVariantUrl={ctrl.setSelectedVariantUrl}
            startTime={ctrl.startTime} setStartTime={ctrl.setStartTime}
            endTime={ctrl.endTime} setEndTime={ctrl.setEndTime}
            availableVideoQualities={ctrl.availableVideoQualities}
            setSelectedYtdlpFormatId={ctrl.setSelectedYtdlpFormatId}
            setTargetResolution={ctrl.setTargetResolution}
            onPasteAndAnalyze={ctrl.onPasteAndAnalyze}
            handleAnalyzeUrlDirectly={ctrl.handleAnalyzeUrlDirectly}
            onPickFolder={ctrl.onPickFolder}
            onDownloadNow={ctrl.onDownloadNow}
            onAddToList={ctrl.onAddToList}
            onStartBatchDownload={ctrl.onStartBatchDownload}
            onOpenExternal={ctrl.onOpenExternal}
            setCommentsSuccessPath={ctrl.setCommentsSuccessPath}
            setIsCommentsDownloading={ctrl.setIsCommentsDownloading}
            lang={lang}
            SmartImage={SmartImage}
            UrlInputBar={UrlInputBar}
            variantLabel={variantLabel}
            YouTubeMusicIcon={YouTubeMusicIcon}
          />
        )}

        {activeTab === 'downloads' && (
          <DownloadList
            lang={lang}
            onOpenFile={ctrl.onOpenFile}
            onOpenFolder={ctrl.onOpenFolder}
            onDelete={ctrl.onDelete}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            lang={lang}
            setLang={ctrl.setLang}
            totalDownloadedBytes={ctrl.totalDownloadedBytes}
            onResetStats={ctrl.onResetStats}
            useInAppPlayer={ctrl.useInAppPlayer}
            setUseInAppPlayer={ctrl.setUseInAppPlayer}
            updateStatus={ctrl.updateStatus}
            onCheckForUpdates={ctrl.onCheckForUpdates}
            onRestartAndInstall={ctrl.onRestartAndInstall}
            engineUpdateStatus={ctrl.engineUpdateStatus}
            engineVersion={ctrl.engineVersion}
            onUpdateEngine={ctrl.onUpdateEngine}
            onUninstall={ctrl.onUninstall}
          />
        )}
      </main>
      
      <ConfirmModal
        isOpen={ctrl.modalConfig.isOpen}
        title={ctrl.modalConfig.title}
        message={ctrl.modalConfig.message}
        confirmText={ctrl.modalConfig.confirmText}
        cancelText={ctrl.modalConfig.cancelText}
        type={ctrl.modalConfig.type}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        onConfirm={ctrl.modalConfig.onConfirm}
        onCancel={ctrl.closeModal}
      />

      <MediaPlayerModal
        isOpen={!!ctrl.mediaPlayerFile}
        filePath={ctrl.mediaPlayerFile?.filePath || ''}
        title={ctrl.mediaPlayerFile?.title}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        onClose={() => ctrl.setMediaPlayerFile(null)}
      />

      {ctrl.isCommentsDownloading && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal-container" style={{ width: '400px', padding: '32px', textAlign: 'center' }}>
            {!ctrl.commentsSuccessPath ? (
              <>
                <div className="spinner-sm" style={{ margin: '0 auto 16px auto', borderTopColor: '#3b82f6', width: '36px', height: '36px', borderWidth: '3px' }}></div>
                <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600 }}>
                  {lang === 'ar' ? 'جاري تحميل ملف التعليقات...' : 'Downloading comments file...'}
                </h3>
                <p className="animate-pulse" style={{ marginTop: '12px', color: '#94a3b8', fontSize: '0.95rem', marginBottom: 0, animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}>
                  {lang === 'ar'
                    ? (ctrl.commentsProgress ? `جاري استخراج التعليقات... ${ctrl.commentsProgress.current} / ~${ctrl.commentsProgress.total}` : 'جاري الاتصال...')
                    : (ctrl.commentsProgress ? `Extracting comments... ${ctrl.commentsProgress.current} / ~${ctrl.commentsProgress.total}` : 'Connecting...')}
                </p>
              </>
            ) : (
              <>
                <div style={{ margin: '0 auto 16px auto', width: '48px', height: '48px', backgroundColor: 'rgba(34, 197, 94, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '24px' }}>
                  {lang === 'ar' ? 'تم تحميل التعليقات بنجاح!' : 'Comments downloaded successfully!'}
                </h3>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={() => {
                      if (ctrl.commentsSuccessPath) {
                         window.cortexDl.openFile(ctrl.commentsSuccessPath);
                      }
                      ctrl.setIsCommentsDownloading(false);
                      ctrl.setCommentsSuccessPath(null);
                    }}
                    style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: lang === 'ar' ? '0' : '6px', marginLeft: lang === 'ar' ? '6px' : '0' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    {lang === 'ar' ? 'فتح الملف' : 'Open File'}
                  </button>
                  <button 
                    className="btn" 
                    onClick={() => {
                      ctrl.setIsCommentsDownloading(false);
                      ctrl.setCommentsSuccessPath(null);
                    }}
                    style={{ padding: '8px 16px', fontSize: '0.9rem', backgroundColor: '#334155', color: '#f8fafc', border: '1px solid #475569' }}
                  >
                    {lang === 'ar' ? 'إغلاق' : 'Close'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
