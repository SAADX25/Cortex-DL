import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

interface SetupState {
  status: string
  progress: number
  message: string
}

interface SetupOverlayProps {
  setupState: SetupState
}

export default function SetupOverlay({ setupState }: SetupOverlayProps) {
  const { status, progress, message } = setupState
  const isError = status === 'error'
  const isDone = status === 'done'

  return (
    <div
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
          maxWidth: '480px',
          background: 'rgba(30, 41, 59, 0.7)', // Slightly transparent --bg-main or --bg-sidebar
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(56, 189, 248, 0.15)', // Cyan border hint
          borderRadius: '24px',
          padding: '40px',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center'
        }}
      >
        <div style={{ position: 'relative', marginBottom: '24px' }}>
          {/* Animated Glow Behind Icon */}
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
              background: isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(56, 189, 248, 0.3)', // Red or Cyan
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
                  <Loader2 size={32} color="var(--accent-primary)" className="spin-animation" style={{ animation: 'spin 2s linear infinite' }} />
                  <style>{`
                    @keyframes spin { 100% { transform: rotate(360deg); } }
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
          {isError ? 'Setup Failed' : isDone ? 'Ready to Go' : 'Initializing Engines'}
        </motion.h2>

        <div style={{ height: '24px', marginBottom: '32px', display: 'flex', alignItems: 'center' }}>
          <AnimatePresence mode="wait">
            <motion.p
              key={message}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.2 }}
              style={{ color: '#a1a1aa', fontSize: '0.95rem', margin: 0 }}
            >
              {message}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Progress Bar Container */}
        <div style={{ 
          width: '100%', 
          height: '6px', 
          background: 'rgba(255,255,255,0.05)', 
          borderRadius: '99px',
          overflow: 'hidden',
          position: 'relative'
        }}>
          {/* Progress Fill */}
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
        </div>

        {/* Percentage Text */}
        <div style={{ 
          width: '100%', 
          display: 'flex', 
          justifyContent: 'space-between',
          marginTop: '12px',
          fontSize: '0.8rem',
          color: '#52525b',
          fontWeight: 500
        }}>
          <span>{Math.round(progress)}%</span>
          <span>100%</span>
        </div>
      </motion.div>
    </div>
  )
}
