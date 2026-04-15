import React from 'react'
import { RefreshCw, AlertTriangle, ShieldAlert } from 'lucide-react'
import { Language, translations } from '../translations'
import { formatBytes } from '../hooks/useDownloadCardVM'

declare const __APP_VERSION__: string

interface SettingsTabProps {
  lang: Language
  setLang: (lang: Language) => void
  totalDownloadedBytes: number
  onResetStats: () => void
  useInAppPlayer: boolean
  setUseInAppPlayer: (val: boolean) => void
  updateStatus: any
  onCheckForUpdates: () => void
  onRestartAndInstall: () => void
  engineUpdateStatus: any
  engineVersion: string
  onUpdateEngine: () => void
  onUninstall: () => void
}

const SettingsTab: React.FC<SettingsTabProps> = ({
  lang,
  setLang,
  totalDownloadedBytes,
  onResetStats,
  useInAppPlayer,
  setUseInAppPlayer,
  updateStatus,
  onCheckForUpdates,
  onRestartAndInstall,
  engineUpdateStatus,
  engineVersion,
  onUpdateEngine,
  onUninstall,
}) => {
  const t = translations[lang]

  return (
    <div className="tab-content fade-in centered-layout">
      <header className="content-header centered-header">
        <h1 className="gradient-text">{t.settings_title}</h1>
        <p className="muted">{t.settings_subtitle}</p>
      </header>

      <section className="minimal-panel" style={{ gap: '3rem' }}>

        {/* Hero Stats */}
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
                  onChange={(e) => setLang(e.target.value as Language)}
                >
                  <option value="en" className="bg-[#1e293b] text-white">English</option>
                  <option value="ar" className="bg-[#1e293b] text-white">العربية</option>
                </select>
                <div className="custom-select-icon">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
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
                onClick={() => {
                  const newValue = !useInAppPlayer
                  setUseInAppPlayer(newValue)
                  localStorage.setItem('cortex-inapp-player', String(newValue))
                }}
              >
                <div className="toggle-switch-thumb" />
              </div>
            </div>
          </div>

          <div className="minimal-row">
            <div className="row-info">
              <span className="row-title">{t.check_for_updates}</span>
              <span className="row-subtitle">
                {updateStatus?.status === 'checking' && t.checking_updates}
                {updateStatus?.status === 'available' && t.update_available}
                {updateStatus?.status === 'progress' && `${t.update_available} ${Math.round(updateStatus.percent || 0)}%`}
                {updateStatus?.status === 'not-available' && t.update_not_available}
                {updateStatus?.status === 'error' && t.update_error}
                {!updateStatus && `${t.settings_current_version}v${__APP_VERSION__}`}
              </span>
            </div>
            <div className="row-control">
              {updateStatus?.status === 'downloaded' ? (
                <button className="btn-ghost-success" onClick={onRestartAndInstall}>
                  {t.update_downloaded}
                </button>
              ) : (
                <button
                  className="btn-ghost-primary"
                  onClick={onCheckForUpdates}
                  disabled={updateStatus?.status === 'checking' || updateStatus?.status === 'available' || updateStatus?.status === 'progress'}
                >
                  <RefreshCw size={16} className={updateStatus?.status === 'checking' ? 'spin' : ''} />
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
                {engineUpdateStatus?.success === true && <span className="text-green-400">{engineUpdateStatus.message}</span>}
                {engineUpdateStatus?.success === false && <span className="text-red-400">{engineUpdateStatus.message}</span>}
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
          <h3 className="section-header">{t.settings_about}</h3>
          <div className="about-minimal">
            <p className="about-row"><strong>Cortex DL</strong> v{__APP_VERSION__}</p>
            <p className="about-row">{t.settings_developed_by} SAADX25</p>
            <p className="about-row muted">{t.settings_powered_by} yt-dlp & FFmpeg</p>
          </div>
        </div>

        {/* Danger Zone */}
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