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
import { createRoot } from 'react-dom/client'
import Trimmer from './components/AdvancedTrimmer'

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
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => window.cortexDl.reportFirstUiRender()) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [])
  useSettingsInit()
  useDownloadInit()
  useEffect(() => {
    const dispose = initCommentsStore()
    return () => dispose()
  }, [])

  useEffect(() => {
    if (!window.cortexDl.smokeMode) return
    window.__cortexSmokeLifecycle = async (file: string, audioFile?: string, previewUrl?: string) => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
      const overlay = document.createElement('div'); document.body.appendChild(overlay)
      const overlayRoot = createRoot(overlay)
      try {
        overlayRoot.render(<SetupOverlay setupState={{ status: 'checking', progress: 25, message: 'Verifying fixture…' }} />)
        await delay(200)
        const spinner = overlay.querySelector('[data-setup-spinner]')
        if (!spinner) throw new Error('Engine setup spinner missing')
        const before = getComputedStyle(spinner).transform
        await delay(250)
        if (getComputedStyle(spinner).transform === before) throw new Error('Engine setup animation stalled')
        overlayRoot.render(<SetupOverlay setupState={{ status: 'repairing', progress: 60, message: 'Downloading fixture: 1 MB / 2 MB…' }} />)
        await delay(100)
        if (overlay.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') !== '60') throw new Error('Engine setup progress stalled')
      } finally { overlayRoot.unmount(); overlay.remove() }
      for (const [source, count, selector] of [[file, 10, 'video'], [audioFile, 20, 'audio']] as const) {
        if (!source) continue
        for (let i = 0; i < count; i++) {
          useUIStore.getState().setMediaPlayerFile({ filePath: source, title: 'Packaged fixture' })
          for (let n = 0; n < 100; n++) { if ((document.querySelector(selector) as HTMLMediaElement)?.readyState) break; await delay(50) }
          const media = document.querySelector(selector) as HTMLMediaElement
          if (!media || media.readyState < 1) throw new Error('Packaged player failed to load: ' + JSON.stringify({ selector, present: !!media, readyState: media?.readyState, networkState: media?.networkState, error: media?.error?.code, sourceSet: !!media?.currentSrc }))
          if (selector === 'video' && i === 0) {
            const video = media as HTMLVideoElement
            if (video.videoWidth !== 1920 || video.videoHeight !== 1080) throw new Error('Packaged player lost 1080p resolution')
            for (let n = 0; n < 100; n++) { if (video.textTracks.length >= 3 && document.querySelector('[aria-label="Subtitle language"]')) break; await delay(50) }
            const languages = document.querySelector('[aria-label="Subtitle language"]') as HTMLSelectElement
            if (!languages || video.textTracks.length < 3) throw new Error('Embedded and external captions were not discovered')
            for (let index = 0; index < video.textTracks.length; index++) {
              languages.value = String(index); languages.dispatchEvent(new Event('change', { bubbles: true }))
              const track = video.textTracks[index]
              for (let n = 0; n < 100; n++) { if (track.cues?.length && track.mode === 'showing') break; await delay(50) }
              if (!track.cues?.length || track.mode !== 'showing') throw new Error('Selected caption track failed to load')
              await video.play(); await delay(100); video.pause(); video.currentTime = 0.5; await delay(150)
              if (!track.activeCues?.length || video.currentTime < 0.4 || !video.paused) throw new Error('Caption cues missing after seek/pause')
            }
            languages.value = '-1'; languages.dispatchEvent(new Event('change', { bubbles: true })); await delay(50)
            if (Array.from(video.textTracks).some(track => track.mode === 'showing')) throw new Error('Captions did not turn off')
          }
          useUIStore.getState().setMediaPlayerFile(null)
          await delay(100)
          if (document.querySelector(selector)) throw new Error('Player failed to close')
        }
      }
      if (previewUrl) {
        for (let i = 0; i < 20; i++) {
          const container = document.createElement('div'); document.body.appendChild(container)
          const root = createRoot(container)
          try {
            root.render(<Trimmer videoUrl={previewUrl} duration={1} onConfirm={() => {}} />)
            for (let n = 0; n < 100; n++) { if (container.querySelector('video')?.readyState) break; await delay(50) }
            const video = container.querySelector('video')
            if (!video || video.readyState < 1) throw new Error('Packaged Visual Trim preview failed')
            if (!video.controls || video.muted) throw new Error('Visual Trim native sound control missing')
            video.muted = true; await delay(50)
            if (!video.muted) throw new Error('Visual Trim mute failed')
            video.muted = false; await delay(50)
            if (video.muted) throw new Error('Visual Trim unmute failed')
          } finally { root.unmount(); container.remove() }
          await delay(50)
        }
      }
      return true
    }
    return () => { delete window.__cortexSmokeLifecycle }
  }, [])
  const lang = useSettingsStore((s) => s.lang)
  const refreshHealth = useSettingsStore((s) => s.refreshHealth)

  const activeTab = useUIStore((s) => s.activeTab)
  const toastMsg = useUIStore((s) => s.toastMsg)
  const modalConfig = useUIStore((s) => s.modalConfig)
  const closeModal = useUIStore((s) => s.closeModal)
  const mediaPlayerFile = useUIStore((s) => s.mediaPlayerFile)
  const setMediaPlayerFile = useUIStore((s) => s.setMediaPlayerFile)

  useEffect(() => window.cortexDl.onCloseMediaPlayer(() => setMediaPlayerFile(null)), [setMediaPlayerFile])

  const isCommentsDownloading = useCommentsStore((s) => s.isCommentsDownloading)
  const commentsSuccessPath = useCommentsStore((s) => s.commentsSuccessPath)
  const commentsProgress = useCommentsStore((s) => s.commentsProgress)
  const setIsCommentsDownloading = useCommentsStore((s) => s.setIsCommentsDownloading)
  const setCommentsSuccessPath = useCommentsStore((s) => s.setCommentsSuccessPath)

  const [setupState, setSetupState] = useState<{ status: string; progress: number; message: string } | null>(null)

  useEffect(() => {
    if (window.cortexDl && window.cortexDl.onSetupProgress) {
      let disposed = false
      let receivedProgress = false
      const unsubscribe = window.cortexDl.onSetupProgress((state) => {
        receivedProgress = true
        setSetupState(state)
        // After setup finishes downloading engines, refresh the health check
        // so the UI immediately reflects the newly installed binaries
        if (state.status === 'ready') {
          void refreshHealth()
        }
      })
      // A late snapshot must not replace a newer ready/progress event.
      void window.cortexDl.getSetupState().then(state => {
        if (!disposed && !receivedProgress) setSetupState(state)
      }).catch(error => console.error('[Setup] State request failed:', error))
      return () => { disposed = true; unsubscribe() }
    }
  }, [refreshHealth])


  return (
    <div className="app-container" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {setupState && ['repairing', 'repair-required', 'degraded', 'fatal'].includes(setupState.status) && <SetupOverlay setupState={setupState} />}
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
      {mediaPlayerFile && (
        <MediaPlayerModal
          key={mediaPlayerFile.filePath}
          isOpen
          filePath={mediaPlayerFile.filePath}
          title={mediaPlayerFile.title}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          onClose={() => setMediaPlayerFile(null)}
        />
      )}

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
