import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, ClipboardPaste } from 'lucide-react'
import './App.css'
import ConfirmModal from './components/ConfirmModal'
import MediaPlayerModal from './components/MediaPlayer/MediaPlayerModal'
import DownloadList from './components/DownloadList'
import Sidebar from './components/Sidebar'
import SettingsTab from './components/SettingsTab'
import AddDownloadTab from './components/AddDownloadTab'
import SmartImage from './components/SmartImage'
import { useAppController, variantLabel } from './hooks/useAppController'
import { useUIStore } from './stores/useUIStore'
import React from 'react'

/** YouTube Music icon — a play button inside a circle */
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
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 8.5 L15.5 12 L10.5 15.5 Z" fill="currentColor" />
    </svg>
  )
}

/**
 * URL input bar — paste & go, or type a URL and analyze.
 * Memoized to avoid unnecessary re-renders from parent state changes.
 */
export const UrlInputBar = React.memo((
  {
    analyzing,
    batchCount,
    maxBatchItems,
    placeholderText,
    pasteAndGoText,
    onPasteAndAnalyze,
    onAnalyze,
    onClear,
    initialUrl = '',
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
  }
) => {
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
        aria-label="URL input"
      />
      {localUrl && (
        <button
          className="hero-clear-btn"
          onClick={() => { setLocalUrl(''); onClear() }}
          aria-label="Clear URL"
        >
          <X size={20} />
        </button>
      )}
      <button
        className="hero-action-btn"
        onClick={localUrl.trim().length === 0 ? onPasteAndAnalyze : () => onAnalyze(localUrl)}
        disabled={analyzing}
        aria-label={localUrl.trim().length === 0 ? pasteAndGoText : 'Analyze URL'}
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
UrlInputBar.displayName = 'UrlInputBar'

/**
 * Tab pane wrapper — all tabs stay mounted to avoid first-visit jank.
 * Only the active tab is visible; inactive tabs use display:none so
 * React keeps their state and DOM in memory (instant re-show).
 */
const tabPaneStyle = (isActive: boolean): React.CSSProperties => ({
  width: '100%',
  height: '100%',
  display: isActive ? 'flex' : 'none',
  flexDirection: 'column',
  opacity: isActive ? 1 : 0,
  transition: 'opacity 0.18s ease',
})

function App() {
  const ctrl = useAppController()
  const lang = ctrl.lang

  const activeTab = useUIStore((s) => s.activeTab)
  const toastMsg  = useUIStore((s) => s.toastMsg)

  /**
   * SmartImage is bound to the resolved thumb port so Instagram thumbnails
   * are proxied correctly. Created once per port value — not per render.
   */
  const BoundSmartImage = React.useMemo<React.FC<any>>(() => {
    return (props: any) => <SmartImage {...props} thumbPort={ctrl.thumbPort} />
  }, [ctrl.thumbPort])

  return (
    <div className="app-container" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Sidebar lang={lang} />

      <main className="main-content">
        {/* ── Animated Toast Notification ── */}
        <AnimatePresence>
          {toastMsg && (
            <motion.div
              className="toast-notification"
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {toastMsg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Main Tab Content — all tabs stay mounted for instant switching ── */}
        <div style={tabPaneStyle(activeTab === 'add')}>
          <AddDownloadTab
            MAX_BATCH_ITEMS={ctrl.MAX_BATCH_ITEMS}
            subfolderName={ctrl.subfolderName}                 setSubfolderName={ctrl.setSubfolderName}
            speedLimit={ctrl.speedLimit}                       setSpeedLimit={ctrl.setSpeedLimit}
            targetFormat={ctrl.targetFormat}                   setTargetFormat={ctrl.setTargetFormat}
            isAudioMode={ctrl.isAudioMode}                     setIsAudioMode={ctrl.setIsAudioMode}
            selectedQuality={ctrl.selectedQuality}             setSelectedQuality={ctrl.setSelectedQuality}
            selectedSubtitleLanguage={ctrl.selectedSubtitleLanguage}
            setSelectedSubtitleLanguage={ctrl.setSelectedSubtitleLanguage}
            selectedVariantUrl={ctrl.selectedVariantUrl}       setSelectedVariantUrl={ctrl.setSelectedVariantUrl}
            startTime={ctrl.startTime}                         setStartTime={ctrl.setStartTime}
            endTime={ctrl.endTime}                             setEndTime={ctrl.setEndTime}
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
            SmartImage={BoundSmartImage}
            UrlInputBar={UrlInputBar}
            variantLabel={variantLabel}
            YouTubeMusicIcon={YouTubeMusicIcon}
            removeAnalyzedPlaylistVideo={ctrl.removeAnalyzedPlaylistVideo}
            togglePlaylistItemSelected={ctrl.togglePlaylistItemSelected}
            selectAllPlaylistItems={ctrl.selectAllPlaylistItems}
            deselectAllPlaylistItems={ctrl.deselectAllPlaylistItems}
            clearPlaylistItems={ctrl.clearPlaylistItems}
          />
        </div>

        <div style={tabPaneStyle(activeTab === 'downloads')}>
          <DownloadList
            lang={lang}
            onOpenFile={ctrl.onOpenFile}
            onOpenFolder={ctrl.onOpenFolder}
            onDelete={ctrl.onDelete}
          />
        </div>

        <div style={tabPaneStyle(activeTab === 'settings')}>
          <SettingsTab
            lang={lang}
            setLang={ctrl.setLang}
            totalDownloadedBytes={ctrl.totalDownloadedBytes}
            onResetStats={ctrl.onResetStats}
            useInAppPlayer={ctrl.useInAppPlayer}
            setUseInAppPlayer={ctrl.setUseInAppPlayer}
            cookieFilePath={ctrl.cookieFilePath}
            cookieValidation={ctrl.cookieValidation}
            healthCheck={ctrl.healthCheck}
            healthChecking={ctrl.healthChecking}
            onSelectCookieFile={ctrl.onSelectCookieFile}
            onClearCookieFile={ctrl.onClearCookieFile}
            onRefreshHealth={ctrl.refreshHealth}
            concurrentDownloads={ctrl.concurrentDownloads}
            setConcurrentDownloads={ctrl.setConcurrentDownloads}
            updateStatus={ctrl.updateStatus}
            onCheckForUpdates={ctrl.onCheckForUpdates}
            onRestartAndInstall={ctrl.onRestartAndInstall}
            engineUpdateStatus={ctrl.engineUpdateStatus}
            engineVersion={ctrl.engineVersion}
            onUpdateEngine={ctrl.onUpdateEngine}
            onUninstall={ctrl.onUninstall}
          />
        </div>
      </main>

      {/* ── Confirm Modal ── */}
      <ConfirmModal
        isOpen={ctrl.modalConfig.isOpen}
        title={ctrl.modalConfig.title}
        message={ctrl.modalConfig.message}
        confirmText={ctrl.modalConfig.confirmText}
        cancelText={ctrl.modalConfig.cancelText}
        type={ctrl.modalConfig.type}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        onConfirm={ctrl.modalConfig.onConfirm}
        onCancel={() => {
          ctrl.closeModal()
          ctrl.modalConfig.onCancel?.()
        }}
      />

      {/* ── Media Player Modal ── */}
      <MediaPlayerModal
        isOpen={!!ctrl.mediaPlayerFile}
        filePath={ctrl.mediaPlayerFile?.filePath || ''}
        title={ctrl.mediaPlayerFile?.title}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        onClose={() => ctrl.setMediaPlayerFile(null)}
      />

      {/* ── Comments Download Modal ── */}
      <AnimatePresence>
        {ctrl.isCommentsDownloading && (
          <motion.div
            className="modal-overlay"
            style={{ zIndex: 9999 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="modal-container"
              style={{ width: '400px', padding: '32px', textAlign: 'center' }}
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 16 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {!ctrl.commentsSuccessPath ? (
                <>
                  <div className="spinner-sm" style={{ margin: '0 auto 16px auto', borderTopColor: '#3b82f6', width: '36px', height: '36px', borderWidth: '3px' }}></div>
                  <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600 }}>
                    {lang === 'ar' ? 'جاري تحميل ملف التعليقات...' : 'Downloading comments file...'}
                  </h3>
                  <p style={{ marginTop: '12px', color: '#94a3b8', fontSize: '0.95rem', marginBottom: 0, animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}>
                    {lang === 'ar'
                      ? (ctrl.commentsProgress ? `جاري استخراج التعليقات... ${ctrl.commentsProgress.current} / ~${ctrl.commentsProgress.total}` : 'جاري الاتصال...')
                      : (ctrl.commentsProgress ? `Extracting comments... ${ctrl.commentsProgress.current} / ~${ctrl.commentsProgress.total}` : 'Connecting...')}
                  </p>
                </>
              ) : (
                <>
                  <div style={{ margin: '0 auto 16px auto', width: '48px', height: '48px', backgroundColor: 'rgba(34, 197, 94, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '24px' }}>
                    {lang === 'ar' ? 'تم تحميل التعليقات بنجاح!' : 'Comments downloaded successfully!'}
                  </h3>
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        if (ctrl.commentsSuccessPath) {
                          window.cortexDl.openFile(ctrl.commentsSuccessPath)
                        }
                        ctrl.setIsCommentsDownloading(false)
                        ctrl.setCommentsSuccessPath(null)
                      }}
                      style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: lang === 'ar' ? '0' : '6px', marginLeft: lang === 'ar' ? '6px' : '0' }}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                      </svg>
                      {lang === 'ar' ? 'فتح الملف' : 'Open File'}
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        ctrl.setIsCommentsDownloading(false)
                        ctrl.setCommentsSuccessPath(null)
                      }}
                      style={{ padding: '8px 16px', fontSize: '0.9rem', backgroundColor: '#334155', color: '#f8fafc', border: '1px solid #475569' }}
                    >
                      {lang === 'ar' ? 'إغلاق' : 'Close'}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
