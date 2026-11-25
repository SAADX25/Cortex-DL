// Application settings, engine readiness checks, updates, and uninstall controls
import React from 'react'
import {
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  Sparkles,
  ArrowDownToLine,
  RotateCcw,
} from 'lucide-react'
import { formatMessage, languageNames, translations, type Language } from '../translations'
import { formatBytes } from '../hooks/useDownloadCardVM'
import { useLang, useSettingsStore } from '../stores/useSettingsStore'

declare const __APP_VERSION__: string

const SettingsTab: React.FC = () => {
  const lang = useLang()
  const t = translations[lang]

  const setLang = useSettingsStore(s => s.setLang)
  const totalDownloadedBytes = useSettingsStore(s => s.totalDownloadedBytes)
  const onResetStats = useSettingsStore(s => s.onResetStats)
  const useInAppPlayer = useSettingsStore(s => s.useInAppPlayer)
  const setUseInAppPlayer = useSettingsStore(s => s.setUseInAppPlayer)
  const refreshWindowsArtwork = useSettingsStore(s => s.refreshWindowsPlayerArtwork)
  const setRefreshWindowsArtwork = useSettingsStore(s => s.setRefreshWindowsPlayerArtwork)
  const healthCheck = useSettingsStore(s => s.healthCheck)
  const healthChecking = useSettingsStore(s => s.healthChecking)
  const refreshHealth = useSettingsStore(s => s.refreshHealth)
  const concurrentDownloads = useSettingsStore(s => s.concurrentDownloads)
  const setConcurrentDownloads = useSettingsStore(s => s.setConcurrentDownloads)
  const updateState = useSettingsStore(s => s.updateState)
  const onCheckForUpdates = useSettingsStore(s => s.onCheckForUpdates)
  const onRestartAndInstall = useSettingsStore(s => s.onRestartAndInstall)
  const openUpdateModal = useSettingsStore(s => s.openUpdateModal)
  const u = t.updater
  const updatePercent = Math.min(100, Math.max(0, Math.round(updateState.progress?.percent ?? 0)))
  const engineUpdateStatus = useSettingsStore(s => s.engineUpdateStatus)
  const engineVersion = useSettingsStore(s => s.engineVersion)
  const onUpdateEngine = useSettingsStore(s => s.onUpdateEngine)
  const onUninstall = useSettingsStore(s => s.onUninstall)

  const healthRows = healthCheck
    ? [
        {
          label: t.health_ytdlp,
          ok: healthCheck.ytDlp.available,
          detail: healthCheck.ytDlp.available ? healthCheck.ytDlp.version : t.health_missing,
        },
        {
          label: t.health_ffmpeg,
          ok: healthCheck.ffmpeg.available,
          detail: healthCheck.ffmpeg.available
            ? healthCheck.ffmpeg.version || t.health_available
            : t.health_missing,
        },
        {
          label: t.health_js_runtime,
          ok: healthCheck.jsRuntime.available,
          detail: healthCheck.jsRuntime.available
            ? healthCheck.jsRuntime.name + ' — Supported'
            : 'No supported yt-dlp JS runtime',
        },
        {
          label: t.health_download_directory,
          ok: healthCheck.downloadDirectory.writable,
          detail: healthCheck.downloadDirectory.writable
            ? t.health_writable
            : t.health_not_writable,
          title: healthCheck.downloadDirectory.path,
        },
      ]
    : []

  return (
    <div className="tab-content fade-in centered-layout">
      <header className="content-header centered-header">
        <h1 className="gradient-text">{t.settings_title}</h1>
        <p className="muted">{t.settings_subtitle}</p>
      </header>

      <section className="minimal-panel" style={{ gap: '3rem' }}>
        <div className="settings-hero-stats">
          <div className="hero-stat-value gradient-text-large">
            {formatBytes(totalDownloadedBytes)}
          </div>
          <div className="hero-stat-label">
            {t.total_downloaded}
            <button className="reset-icon-btn" onClick={onResetStats} title={t.reset_stats}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3 className="section-header">{t.settings_general}</h3>

          <div className="minimal-row">
            <div className="row-info">
              <span className="row-title">{t.language_label}</span>
            </div>
            <div className="row-control">
              <div className="custom-select-wrapper">
                <select
                  className="custom-select"
                  value={lang}
                  onChange={e => setLang(e.target.value as Language)}
                >
                  <option value="en" className="bg-[#1e293b] text-white">
                    {languageNames.en}
                  </option>
                  <option value="ar" className="bg-[#1e293b] text-white">
                    {languageNames.ar}
                  </option>
                </select>
                <div className="custom-select-icon">
                  <svg
                    className="fill-current h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div className="minimal-row">
            <div className="row-info">
              <span className="row-title">{t.use_inapp_player}</span>
              <span className="row-subtitle">{t.use_inapp_player_desc}</span>
            </div>
            <div className="row-control">
              <div
                className={`toggle-switch ${useInAppPlayer ? 'active' : ''}`}
                onClick={() => setUseInAppPlayer(!useInAppPlayer)}
              >
                <div className="toggle-switch-thumb" />
              </div>
            </div>
          </div>

          <div className="minimal-row">
            <div className="row-info">
              <span className="row-title">{t.refresh_windows_artwork}</span>
              <span className="row-subtitle">{t.refresh_windows_artwork_desc}</span>
            </div>
            <div className="row-control">
              <button
                type="button"
                role="switch"
                aria-label={t.refresh_windows_artwork}
                aria-checked={refreshWindowsArtwork}
                className={`toggle-switch ${refreshWindowsArtwork ? 'active' : ''}`}
                onClick={() => setRefreshWindowsArtwork(!refreshWindowsArtwork)}
              >
                <span className="toggle-switch-thumb" />
              </button>
            </div>
          </div>

          <div className="minimal-row">
            <div className="row-info">
              <span className="row-title">{t.concurrent_title}</span>
              <span className="row-subtitle">{t.concurrent_desc}</span>
            </div>
            <div className="row-control">
              <div className="custom-select-wrapper">
                <select
                  className="custom-select"
                  value={concurrentDownloads}
                  onChange={e => setConcurrentDownloads(Number(e.target.value))}
                >
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                </select>
                <div className="custom-select-icon">
                  <svg
                    className="fill-current h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div className="minimal-row">
            <div className="row-info">
              <span className="row-title">{t.check_for_updates}</span>
              <span className="row-subtitle">
                {updateState.phase === 'checking' && t.checking_updates}
                {updateState.phase === 'available' && (
                  <span style={{ color: '#38bdf8' }}>
                    {formatMessage(u.availableInline, { version: updateState.latestVersion || '' })}
                  </span>
                )}
                {updateState.phase === 'downloading' && (
                  <span style={{ color: '#7dd3fc' }}>
                    {formatMessage(u.downloadingInline, {
                      version: updateState.latestVersion || '',
                      percent: updatePercent,
                    })}
                  </span>
                )}
                {updateState.phase === 'downloaded' && (
                  <span style={{ color: '#4ade80' }}>
                    {formatMessage(u.downloadedInline, {
                      version: updateState.latestVersion || '',
                    })}
                  </span>
                )}
                {updateState.phase === 'up-to-date' && (
                  <span style={{ color: '#4ade80' }}>
                    {formatMessage(u.upToDate, {
                      version: updateState.currentVersion || __APP_VERSION__,
                    })}
                  </span>
                )}
                {updateState.phase === 'error' && (
                  <span style={{ color: '#f87171' }}>
                    {u.errors[updateState.errorCode ?? 'unknown'] ?? t.update_error}
                  </span>
                )}
                {updateState.phase === 'idle' && `${t.settings_current_version}v${__APP_VERSION__}`}
              </span>
              {updateState.phase === 'downloading' && (
                <div className="settings-update-bar" aria-hidden="true">
                  <div
                    className="settings-update-bar-fill"
                    style={{ width: `${updatePercent}%` }}
                  />
                </div>
              )}
            </div>
            <div className="row-control">
              {updateState.phase === 'downloaded' ? (
                <button className="btn-ghost-success" onClick={onRestartAndInstall}>
                  <RotateCcw size={15} />
                  <span>{u.restartAndInstall}</span>
                </button>
              ) : updateState.phase === 'available' ? (
                <button className="btn-ghost-primary" onClick={openUpdateModal}>
                  <Sparkles size={15} />
                  <span>{u.viewUpdate}</span>
                </button>
              ) : updateState.phase === 'downloading' ? (
                <button className="btn-ghost-primary" onClick={openUpdateModal}>
                  <ArrowDownToLine size={15} />
                  <span>{formatMessage(u.viewProgress, { percent: updatePercent })}</span>
                </button>
              ) : (
                <button
                  className="btn-ghost-primary"
                  onClick={onCheckForUpdates}
                  disabled={updateState.phase === 'checking'}
                >
                  <RefreshCw size={16} className={updateState.phase === 'checking' ? 'spin' : ''} />
                  <span>{t.check_for_updates}</span>
                </button>
              )}
            </div>
          </div>

          <div className="minimal-row">
            <div className="row-info">
              <span className="row-title">Engine (yt-dlp)</span>
              <span className="row-subtitle">
                {engineUpdateStatus?.updating && engineUpdateStatus.message}
                {engineUpdateStatus?.success === true && (
                  <span className="text-green-400">{engineUpdateStatus.message}</span>
                )}
                {engineUpdateStatus?.success === false && (
                  <span className="text-red-400">{engineUpdateStatus.message}</span>
                )}
                {!engineUpdateStatus && engineVersion}
              </span>
            </div>
            <div className="row-control">
              <button
                className="btn-ghost-primary"
                onClick={onUpdateEngine}
                disabled={engineUpdateStatus?.updating}
              >
                <RefreshCw size={16} className={engineUpdateStatus?.updating ? 'spin' : ''} />
                <span>Update Engine</span>
              </button>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
            }}
          >
            <div>
              <h3 className="section-header" style={{ marginBottom: '0.35rem' }}>
                {t.health_title}
              </h3>
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                {t.health_desc}
              </p>
            </div>
            <button className="btn-ghost-primary" onClick={refreshHealth} disabled={healthChecking}>
              <RefreshCw size={16} className={healthChecking ? 'spin' : ''} />
              <span>{healthChecking ? t.health_checking : t.health_refresh}</span>
            </button>
          </div>

          <div style={{ display: 'grid', gap: '0.55rem', marginTop: '1rem' }}>
            <div
              role="status"
              style={{
                color: healthCheck?.healthy ? '#22c55e' : '#f59e0b',
                fontSize: '0.86rem',
                fontWeight: 600,
              }}
            >
              {healthChecking
                ? t.health_checking
                : healthCheck?.healthy
                  ? t.health_ready
                  : t.health_attention}
            </div>

            <div className="about-row muted">
              v{__APP_VERSION__} · {__BUILD_SHA__.slice(0, 12)}
            </div>
            <div className="about-row muted">
              ffprobe:{' '}
              {healthCheck?.ffprobe?.version || healthCheck?.ffprobe?.message || 'Unchecked'} ·
              Database: {healthCheck?.database?.healthy ? 'Healthy' : 'Unchecked'}
            </div>
            <div className="about-row muted">
              Media server: {healthCheck?.mediaServer?.healthy ? 'Healthy' : 'Unchecked'} · Update
              service: {healthCheck?.updateService || 'Unchecked'}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn-ghost-primary"
                onClick={() => void window.cortexDl.repairEngines().then(refreshHealth)}
              >
                Repair Engines
              </button>
              <button
                className="btn-ghost-primary"
                onClick={() => void window.cortexDl.exportDiagnostics()}
              >
                Export Diagnostics
              </button>
              <button className="btn-ghost-primary" onClick={() => void window.cortexDl.openLogs()}>
                Open Logs
              </button>
            </div>
            {healthRows.map(row => (
              <div
                key={row.label}
                title={'title' in row ? row.title : undefined}
                className="minimal-row"
                style={{ padding: '0.65rem 0' }}
              >
                <span className="row-title">{row.label}</span>
                <span
                  className="row-subtitle"
                  style={{ color: row.ok ? '#22c55e' : '#f87171', textAlign: 'end' }}
                >
                  {row.detail}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h3 className="section-header">{t.settings_about}</h3>
          <div className="about-minimal">
            <p className="about-row">
              <strong>Cortex DL</strong> v{__APP_VERSION__}
            </p>
            <p className="about-row">{t.settings_developed_by} SAADX25</p>
            <p className="about-row muted">{t.settings_powered_by} yt-dlp &amp; FFmpeg</p>
          </div>
        </div>

        <div className="settings-section danger-zone">
          <h3 className="section-header danger-text">
            <AlertTriangle size={18} />
            {t.settings_danger_zone}
          </h3>
          <div className="minimal-row danger-row">
            <div className="row-info">
              <span className="row-title">{t.settings_uninstall_title}</span>
              <span className="row-subtitle">{t.settings_uninstall_desc}</span>
            </div>
            <div className="row-control">
              <button className="btn-danger-outline" onClick={onUninstall}>
                <ShieldAlert size={16} />
                <span>{t.settings_uninstall_btn}</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default SettingsTab
