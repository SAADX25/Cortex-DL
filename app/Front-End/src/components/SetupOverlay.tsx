import { useState } from 'react'
import './SetupOverlay.css'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, FolderOpen, X } from 'lucide-react'

interface SetupState {
  status: string
  progress: number
  message: string
}

interface SetupOverlayProps {
  setupState: SetupState
}

export default function SetupOverlay({ setupState }: SetupOverlayProps) {
  const { status, message } = setupState
  const progress = Math.min(100, Math.max(0, Number.isFinite(setupState.progress) ? setupState.progress : 0))
  const [retrying, setRetrying] = useState(false)
  const [actionError, setActionError] = useState('')
  const retrySetup = async () => {
    if (retrying) return
    setRetrying(true)
    setActionError('')
    try { await window.cortexDl.repairEngines() }
    catch { setActionError('Could not restart setup. Open the log folder for details.') }
    finally { setRetrying(false) }
  }
  const openLogs = async () => {
    setActionError('')
    try { await window.cortexDl.openLogs() }
    catch { setActionError('Could not open the log folder. Try again.') }
  }
  const exitApp = async () => {
    try { await window.cortexDl.exitApp() }
    catch { setActionError('Could not close the app. Use the window close button.') }
  }
  const isError = status === 'repair-required' || status === 'degraded' || status === 'fatal'
  const isDone = status === 'ready'

  return (
    <div
      data-setup-overlay
      aria-busy={!isError && !isDone || retrying}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--bg-main)',
        backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.15) 0%, transparent 70%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        color: 'var(--text-main)',
        fontFamily: 'Segoe UI, system-ui, sans-serif'
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{
          width: '100%',
          maxWidth: '560px',
          margin: '20px',
          maxHeight: 'calc(100% - 40px)',
          overflowY: 'auto',
          background: 'rgba(30, 41, 59, 0.7)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(56, 189, 248, 0.15)',
          borderRadius: '24px',
          padding: 'clamp(24px, 5vw, 40px)',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center'
        }}
      >
        <div style={{ position: 'relative', marginBottom: '24px' }}>

          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.5, 0.8, 0.5]
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            style={{
              position: 'absolute',
              inset: '-20px',
              background: isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(56, 189, 248, 0.3)',
              filter: 'blur(24px)',
              borderRadius: '50%',
              zIndex: 0
            }}
          />

          <div style={{
            position: 'relative',
            zIndex: 1,
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.02))',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <AnimatePresence mode="wait">
              {isError ? (
                <motion.div key="error" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                  <AlertCircle size={32} color="#ef4444" />
                </motion.div>
              ) : isDone ? (
                <motion.div key="done" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                  <CheckCircle2 size={32} color="var(--success)" />
                </motion.div>
              ) : (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Loader2 data-setup-spinner size={32} color="var(--accent-primary)" style={{ animation: 'cortex-setup-spin 1s linear infinite', willChange: 'transform' }} />
                  <style>{`
                    @keyframes cortex-setup-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                    @keyframes cortex-setup-scan { from { transform: translateX(-100%); } to { transform: translateX(400%); } }
                  `}</style>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <motion.h2
          style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            margin: '0 0 8px 0',
            background: 'linear-gradient(to right, #fff, #a1a1aa)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}
        >
          {isError ? 'Setup Failed' : isDone ? 'Ready to Go' : status === 'checking' ? 'Checking Local Engines' : 'Preparing Engines'}
        </motion.h2>

        <div role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} style={{ minHeight: '24px', marginBottom: '32px', display: 'flex', alignItems: 'center' }}>
          <p style={{ color: '#cbd5e1', fontSize: '0.95rem', margin: 0 }}>{message}</p>
        </div>

        {isError && <div className="setup-recovery">
          <p className="setup-recovery-hint">Restore missing or damaged engines to continue.</p>
          <div className="setup-actions">
            <button type="button" className="setup-action setup-action-primary" onClick={() => void retrySetup()} disabled={retrying}>
              <RefreshCw size={17} aria-hidden="true" className={retrying ? 'setup-action-spinning' : undefined} />
              {retrying ? 'Retrying…' : 'Retry Setup'}
            </button>
            <button type="button" className="setup-action" onClick={() => void openLogs()}>
              <FolderOpen size={17} aria-hidden="true" />Open Log Folder
            </button>
            <button type="button" className="setup-action setup-action-quiet" onClick={() => void exitApp()}>
              <X size={17} aria-hidden="true" />Exit
            </button>
          </div>
          {actionError && <p className="setup-action-error" role="alert">{actionError}</p>}
        </div>}

        <div style={{
          width: '100%',
          height: '6px',
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '99px',
          overflow: 'hidden',
          position: 'relative'
        }} role="progressbar" aria-label="Engine setup" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>

          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', damping: 20, stiffness: 100 }}
            style={{
              height: '100%',
              background: isError
                ? 'var(--error)'
                : 'linear-gradient(90deg, #0ea5e9 0%, #38bdf8 50%, #7dd3fc 100%)',
              borderRadius: '99px',
              position: 'relative',
              boxShadow: isError
                ? '0 0 10px rgba(239,68,68,0.5)'
                : '0 0 12px rgba(56,189,248,0.6)'
            }}
          />
          {!isDone && !isError && <div style={{
            position: 'absolute', inset: 0, width: '25%',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent)',
            animation: 'cortex-setup-scan 1.4s linear infinite', willChange: 'transform'
          }} />}
        </div>

        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '12px',
          fontSize: '0.8rem',
          color: '#94a3b8',
          fontWeight: 500
        }}>
          <span>{Math.round(progress)}%</span>
          <span>100%</span>
        </div>
      </motion.div>
    </div>
  )
}
