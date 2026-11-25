// In-app software update dialog replacing native Windows message boxes with live progress, notes, and bilingual RTL/LTR support.
import React, { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  Download,
  Minimize2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { formatMessage, translations, type Language } from '../translations'
import { useLang, useSettingsStore } from '../stores/useSettingsStore'
import { useActiveDownloadCount } from '../stores/downloadStore'
import { formatBytes } from '../hooks/useDownloadCardVM'
import './UpdateModal.css'

function formatReleaseDate(raw: string | null, lang: Language): string | null {
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(parsed)
  } catch {
    return null
  }
}

function formatUpdateEta(seconds: number | null, lang: Language): string {
  const u = translations[lang].updater
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return u.calculating
  }
  if (seconds < 60) {
    return formatMessage(u.secondsShort, { value: Math.ceil(seconds) })
  }
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.ceil(seconds % 60)
  return formatMessage(u.minutesSecondsShort, { m: minutes, s: remainder })
}

const RING_RADIUS = 31
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const UpdateModal: React.FC = () => {
  const lang = useLang()
  const t = translations[lang]
  const u = t.updater
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const prefersReducedMotion = useReducedMotion()

  const updateState = useSettingsStore(s => s.updateState)
  const updateModalOpen = useSettingsStore(s => s.updateModalOpen)
  const closeUpdateModal = useSettingsStore(s => s.closeUpdateModal)
  const onDownloadUpdate = useSettingsStore(s => s.onDownloadUpdate)
  const onCancelUpdateDownload = useSettingsStore(s => s.onCancelUpdateDownload)
  const onRestartAndInstall = useSettingsStore(s => s.onRestartAndInstall)
  const onCheckForUpdates = useSettingsStore(s => s.onCheckForUpdates)
  const activeDownloadCount = useActiveDownloadCount()

  const {
    phase,
    currentVersion,
    latestVersion,
    releaseDate,
    releaseNotes,
    totalSizeBytes,
    progress,
    errorCode,
    errorDetail,
    canCancel,
  } = updateState

  const isVisible =
    updateModalOpen &&
    (phase === 'available' ||
      phase === 'downloading' ||
      phase === 'downloaded' ||
      phase === 'error')

  useEffect(() => {
    if (!isVisible) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeUpdateModal()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isVisible, closeUpdateModal])

  const percent = Math.min(
    100,
    Math.max(0, Math.round(progress?.percent ?? (phase === 'downloaded' ? 100 : 0))),
  )
  const ringOffset = RING_CIRCUMFERENCE - (percent / 100) * RING_CIRCUMFERENCE
  const formattedDate = formatReleaseDate(releaseDate, lang)
  const displaySize = progress?.totalBytes || totalSizeBytes
  const speedText =
    progress && progress.bytesPerSecond > 0
      ? `${formatBytes(progress.bytesPerSecond)}/${t.speed_unit}`
      : u.calculating

  const errorMessage = u.errors[errorCode ?? 'unknown'] ?? u.errors.unknown

  const title =
    phase === 'downloading'
      ? u.downloadingTitle
      : phase === 'downloaded'
        ? u.downloadedTitle
        : phase === 'error'
          ? u.errorTitle
          : u.availableTitle

  const subtitle =
    phase === 'downloading'
      ? u.downloadingSubtitle
      : phase === 'downloaded'
        ? formatMessage(u.downloadedSubtitle, { version: latestVersion || currentVersion })
        : phase === 'error'
          ? errorMessage
          : u.availableSubtitle

  const handleRetry = () => {
    if (latestVersion) {
      void onDownloadUpdate()
    } else {
      void onCheckForUpdates()
    }
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="update-modal-overlay"
          dir={dir}
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-modal-title"
          aria-describedby="update-modal-subtitle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.18 }}
          onClick={event => {
            if (event.target === event.currentTarget) closeUpdateModal()
          }}
        >
          <motion.div
            className={`update-modal-card phase-${phase}`}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 18 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 14 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <button
              type="button"
              className="update-modal-close"
              onClick={closeUpdateModal}
              aria-label={u.close}
            >
              <X size={18} />
            </button>

            <div className="update-modal-hero">
              <div className={`update-modal-emblem phase-${phase}`} aria-hidden="true">
                <div className="update-modal-emblem-glow" />
                {phase === 'downloading' && (
                  <svg className="update-modal-ring" viewBox="0 0 68 68">
                    <circle className="update-modal-ring-track" cx="34" cy="34" r={RING_RADIUS} />
                    <circle
                      className="update-modal-ring-fill"
                      cx="34"
                      cy="34"
                      r={RING_RADIUS}
                      strokeDasharray={RING_CIRCUMFERENCE}
                      strokeDashoffset={ringOffset}
                    />
                  </svg>
                )}
                <div className="update-modal-emblem-core">
                  {phase === 'downloading' && (
                    <ArrowDownToLine size={26} className="update-modal-download-icon" />
                  )}
                  {phase === 'downloaded' && <CheckCircle2 size={28} />}
                  {phase === 'error' && <AlertCircle size={28} />}
                  {phase === 'available' && <Sparkles size={26} />}
                </div>
              </div>

              <h2 className="update-modal-title" id="update-modal-title">
                {title}
              </h2>

              {latestVersion && (
                <div
                  className="update-version-row"
                  dir="ltr"
                  aria-label={formatMessage(u.versionTransition, {
                    current: currentVersion,
                    latest: latestVersion,
                  })}
                >
                  <span className="update-version-chip current">v{currentVersion}</span>
                  <ArrowRight size={14} className="update-version-arrow" aria-hidden="true" />
                  <span className={`update-version-chip latest phase-${phase}`}>
                    v{latestVersion}
                  </span>
                </div>
              )}

              {(displaySize || formattedDate) && phase !== 'error' && (
                <div className="update-meta-row">
                  {displaySize ? (
                    <span className="update-meta-item">
                      {u.installerSize}: <strong dir="ltr">{formatBytes(displaySize)}</strong>
                    </span>
                  ) : null}
                  {displaySize && formattedDate ? (
                    <span className="update-meta-dot" aria-hidden="true">
                      ·
                    </span>
                  ) : null}
                  {formattedDate ? (
                    <span className="update-meta-item">
                      {u.releaseDateLabel}: <strong>{formattedDate}</strong>
                    </span>
                  ) : null}
                </div>
              )}

              <p className="update-modal-subtitle" id="update-modal-subtitle">
                {subtitle}
              </p>
            </div>

            <div className="update-modal-body">
              {phase === 'available' && (
                <>
                  {releaseNotes.length > 0 && (
                    <div className="update-notes-card">
                      <div className="update-notes-header">{u.whatsNew}</div>
                      <ul className="update-notes-list">
                        {releaseNotes.map((line, index) => (
                          <li key={index} className="update-notes-item">
                            <span className="update-notes-bullet" aria-hidden="true" />
                            <span dir="auto">{line}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="update-trust-strip">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>{u.preservedNote}</span>
                  </div>
                </>
              )}

              {phase === 'downloading' && (
                <div className="update-progress-panel">
                  <div className="update-progress-top">
                    <span className="update-progress-status">
                      {progress && progress.transferredBytes > 0 && progress.totalBytes > 0
                        ? formatMessage(u.downloadedProgress, {
                            transferred: formatBytes(progress.transferredBytes),
                            total: formatBytes(progress.totalBytes),
                          })
                        : u.preparingDownload}
                    </span>
                    <span className="update-progress-percent" dir="ltr">
                      {percent}%
                    </span>
                  </div>

                  <div
                    className="update-progress-track"
                    role="progressbar"
                    aria-label={u.downloadingTitle}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <div className="update-progress-fill" style={{ width: `${percent}%` }} />
                    <div className="update-progress-shimmer" aria-hidden="true" />
                  </div>

                  <div className="update-metrics-grid">
                    <div className="update-metric-box">
                      <span className="update-metric-label">{u.speedLabel}</span>
                      <span className="update-metric-value" dir="ltr">
                        {speedText}
                      </span>
                    </div>
                    <div className="update-metric-box">
                      <span className="update-metric-label">{u.remainingLabel}</span>
                      <span className="update-metric-value">
                        {formatUpdateEta(progress?.etaSeconds ?? null, lang)}
                      </span>
                    </div>
                  </div>

                  <p className="update-background-hint">{u.backgroundHint}</p>
                </div>
              )}

              {phase === 'downloaded' && (
                <>
                  {releaseNotes.length > 0 && (
                    <div className="update-notes-card">
                      <div className="update-notes-header">{u.whatsNew}</div>
                      <ul className="update-notes-list">
                        {releaseNotes.slice(0, 5).map((line, index) => (
                          <li key={index} className="update-notes-item">
                            <span className="update-notes-bullet ready" aria-hidden="true" />
                            <span dir="auto">{line}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {activeDownloadCount > 0 ? (
                    <div className="update-warning-strip" role="status">
                      <AlertCircle size={16} aria-hidden="true" />
                      <span>
                        {formatMessage(u.activeDownloadsNote, { count: activeDownloadCount })}
                      </span>
                    </div>
                  ) : (
                    <div className="update-trust-strip ready">
                      <ShieldCheck size={16} aria-hidden="true" />
                      <span>{u.preservedNote}</span>
                    </div>
                  )}
                </>
              )}

              {phase === 'error' && errorDetail && (
                <div className="update-error-detail" dir="ltr" role="alert">
                  {errorDetail}
                </div>
              )}
            </div>

            <div className="update-modal-footer">
              {phase === 'available' && (
                <>
                  <button
                    type="button"
                    className="update-btn update-btn-ghost"
                    onClick={closeUpdateModal}
                  >
                    {u.later}
                  </button>
                  <button
                    type="button"
                    className="update-btn update-btn-primary"
                    onClick={() => void onDownloadUpdate()}
                  >
                    <Download size={16} aria-hidden="true" />
                    <span>{u.updateNow}</span>
                  </button>
                </>
              )}

              {phase === 'downloading' && (
                <>
                  {canCancel && (
                    <button
                      type="button"
                      className="update-btn update-btn-danger-ghost"
                      onClick={() => void onCancelUpdateDownload()}
                    >
                      <X size={16} aria-hidden="true" />
                      <span>{u.cancelDownload}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="update-btn update-btn-secondary"
                    onClick={closeUpdateModal}
                  >
                    <Minimize2 size={15} aria-hidden="true" />
                    <span>{u.hideToBackground}</span>
                  </button>
                </>
              )}

              {phase === 'downloaded' && (
                <>
                  <button
                    type="button"
                    className="update-btn update-btn-ghost"
                    onClick={closeUpdateModal}
                  >
                    {u.later}
                  </button>
                  <button
                    type="button"
                    className="update-btn update-btn-success"
                    onClick={() => void onRestartAndInstall()}
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                    <span>{u.restartAndInstall}</span>
                  </button>
                </>
              )}

              {phase === 'error' && (
                <>
                  <button
                    type="button"
                    className="update-btn update-btn-ghost"
                    onClick={closeUpdateModal}
                  >
                    {u.close}
                  </button>
                  <button
                    type="button"
                    className="update-btn update-btn-primary"
                    onClick={handleRetry}
                  >
                    <RefreshCw size={16} aria-hidden="true" />
                    <span>{u.retry}</span>
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default UpdateModal
