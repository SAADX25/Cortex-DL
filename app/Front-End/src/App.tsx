import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import './App.css'
import ConfirmModal from './components/ConfirmModal'
import MediaPlayerModal from './components/MediaPlayer/MediaPlayerModal'
import DownloadList from './components/DownloadList'
import Sidebar from './components/Sidebar'
import SettingsTab from './components/SettingsTab'
import AddDownloadTab from './components/AddDownloadTab'
import SetupOverlay from './components/SetupOverlay'
import { useUIStore } from './stores/useUIStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { useCommentsStore, initCommentsStore } from './stores/useCommentsStore'
import { useSettingsInit } from './hooks/useSettingsInit'
import { useDownloadInit } from './hooks/useDownloadInit'
import React from 'react'

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
  // ── One-time side-effect wiring for each state slice ──
  // Dismantles the old `useAppController` god hook: instead of one big hook
  // funneling every piece of app state through `App` (and re-rendering the
  // whole tree on any change anywhere), each slice owns its own init effects
  // and leaf components read only the selectors they actually render.
  useSettingsInit()
  useDownloadInit()
  useEffect(() => {
    const dispose = initCommentsStore()
    return () => dispose()
  }, [])

  const lang = useSettingsStore((s) => s.lang)
  const refreshHealth = useSettingsStore((s) => s.refreshHealth)

  const activeTab = useUIStore((s) => s.activeTab)
  const toastMsg = useUIStore((s) => s.toastMsg)
  const modalConfig = useUIStore((s) => s.modalConfig)
  const closeModal = useUIStore((s) => s.closeModal)
  const mediaPlayerFile = useUIStore((s) => s.mediaPlayerFile)
  const setMediaPlayerFile = useUIStore((s) => s.setMediaPlayerFile)

  const isCommentsDownloading = useCommentsStore((s) => s.isCommentsDownloading)
  const commentsSuccessPath = useCommentsStore((s) => s.commentsSuccessPath)
  const commentsProgress = useCommentsStore((s) => s.commentsProgress)
  const setIsCommentsDownloading = useCommentsStore((s) => s.setIsCommentsDownloading)
  const setCommentsSuccessPath = useCommentsStore((s) => s.setCommentsSuccessPath)

  const [setupState, setSetupState] = useState<{ status: string; progress: number; message: string } | null>(null)

  useEffect(() => {
    if (window.cortexDl && window.cortexDl.onSetupProgress) {
      return window.cortexDl.onSetupProgress((state) => {
        setSetupState(state)
        // After setup finishes downloading engines, refresh the health check
        // so the UI immediately reflects the newly installed binaries
        if (state.status === 'done') {
          void refreshHealth()
        }
      })
    }
  }, [refreshHealth])

  if (setupState && setupState.status !== 'done') {
    return <SetupOverlay setupState={setupState} />
  }

  return (
    <div className="app-container" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Sidebar />

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
          <AddDownloadTab />
        </div>

        <div style={tabPaneStyle(activeTab === 'downloads')}>
          <DownloadList />
        </div>

        <div style={tabPaneStyle(activeTab === 'settings')}>
          <SettingsTab />
        </div>
      </main>

      {/* ── Confirm Modal ── */}
      <ConfirmModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        cancelText={modalConfig.cancelText}
        type={modalConfig.type}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => {
          closeModal()
          modalConfig.onCancel?.()
        }}
      />

      {/* ── Media Player Modal ── */}
      <MediaPlayerModal
        isOpen={!!mediaPlayerFile}
        filePath={mediaPlayerFile?.filePath || ''}
        title={mediaPlayerFile?.title}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        onClose={() => setMediaPlayerFile(null)}
      />

      {/* ── Comments Download Modal ── */}
      <AnimatePresence>
        {isCommentsDownloading && (
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
              {!commentsSuccessPath ? (
                <>
                  <div className="spinner-sm" style={{ margin: '0 auto 16px auto', borderTopColor: '#3b82f6', width: '36px', height: '36px', borderWidth: '3px' }}></div>
                  <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600 }}>
                    {lang === 'ar' ? 'جاري تحميل ملف التعليقات...' : 'Downloading comments file...'}
                  </h3>
                  <p style={{ marginTop: '12px', color: '#94a3b8', fontSize: '0.95rem', marginBottom: 0, animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}>
                    {lang === 'ar'
                      ? (commentsProgress ? `جاري استخراج التعليقات... ${commentsProgress.current} / ~${commentsProgress.total}` : 'جاري الاتصال...')
                      : (commentsProgress ? `Extracting comments... ${commentsProgress.current} / ~${commentsProgress.total}` : 'Connecting...')}
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
                        if (commentsSuccessPath) {
                          window.cortexDl.openFile(commentsSuccessPath)
                        }
                        setIsCommentsDownloading(false)
                        setCommentsSuccessPath(null)
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
                        setIsCommentsDownloading(false)
                        setCommentsSuccessPath(null)
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
