// Primary navigation sidebar with live download badge and external links
import React from 'react'
import { Plus, DownloadCloud, Settings, Github, Captions, Library, Coffee, ArrowUpRight, Sparkles, ArrowDownToLine, CheckCircle2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { formatMessage, translations } from '../translations'
import { useUIStore, type ActiveTab } from '../stores/useUIStore'
import { useLang, useSettingsStore } from '../stores/useSettingsStore'
import { useActiveDownloadCount, useTotalDownloadCount } from '../stores/downloadStore'

const Sidebar: React.FC = () => {
  const lang = useLang()
  const t = translations[lang]
  const s = t.sidebar

  const activeTab = useUIStore((s) => s.activeTab)
  const setActiveTab = useUIStore((s) => s.setActiveTab)

  const activeCount = useActiveDownloadCount()
  const totalCount = useTotalDownloadCount()
  const badgeCount = activeCount > 0 ? activeCount : totalCount

  const updateState = useSettingsStore((s) => s.updateState)
  const openUpdateModal = useSettingsStore((s) => s.openUpdateModal)
  const showUpdatePill =
    updateState.phase === 'available' ||
    updateState.phase === 'downloading' ||
    updateState.phase === 'downloaded'
  const updatePercent = Math.min(100, Math.max(0, Math.round(updateState.progress?.percent ?? 0)))
  const u = t.updater

  const navItems: Array<{
    id: ActiveTab
    label: string
    icon: any
    badge?: number
    isActiveBadge?: boolean
    ariaLabel: string
  }> = [
    {
      id: 'add',
      label: t.nav_add,
      icon: Plus,
      ariaLabel: s.addAria,
    },
    {
      id: 'downloads',
      label: t.nav_downloads,
      icon: DownloadCloud,
      badge: badgeCount,
      isActiveBadge: activeCount > 0,
      ariaLabel: formatMessage(s.downloadsAria, { count: badgeCount }),
    },
    {
      id: 'library',
      label: s.libraryLabel,
      icon: Library,
      ariaLabel: s.libraryLabel,
    },
    {
      id: 'subtitles',
      label: s.subtitlesLabel,
      icon: Captions,
      ariaLabel: s.subtitlesAria,
    },
    {
      id: 'settings',
      label: t.nav_settings,
      icon: Settings,
      ariaLabel: s.settingsAria,
    },
  ]

  return (
    <aside className="sidebar" role="complementary" aria-label={s.sidebarAria}>

      <div className="brand">
        <h1 className="cortex-logo-text">Cortex DL</h1>
      </div>

      <nav className="nav-menu" role="navigation" aria-label={s.mainNavAria}>
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
              aria-label={item.ariaLabel}
              aria-current={isActive ? 'page' : undefined}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className="absolute inset-0 bg-sky-500/10 border border-sky-400/30 rounded-xl"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="nav-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <span className="nav-text">{item.label}</span>

              {item.badge != null && (
                <motion.span
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  key={`${item.badge}-${item.isActiveBadge}`}
                  className={`nav-badge-pill ${item.isActiveBadge ? 'active-pulse' : ''}`}
                  aria-hidden="true"
                >
                  {item.badge}
                </motion.span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-links">
        {showUpdatePill && (
          <button
            type="button"
            className={`sidebar-update-pill phase-${updateState.phase}`}
            onClick={openUpdateModal}
          >
            <span className="sidebar-update-icon" aria-hidden="true">
              {updateState.phase === 'downloading' ? (
                <ArrowDownToLine size={17} />
              ) : updateState.phase === 'downloaded' ? (
                <CheckCircle2 size={17} />
              ) : (
                <Sparkles size={17} />
              )}
            </span>
            <span className="sidebar-link-copy">
              <span className="sidebar-link-title">
                {updateState.phase === 'downloading'
                  ? formatMessage(u.sidebarDownloadingTitle, { percent: updatePercent })
                  : updateState.phase === 'downloaded'
                    ? u.sidebarReadyTitle
                    : formatMessage(u.sidebarAvailableTitle, { version: updateState.latestVersion || '' })}
              </span>
              <span className="sidebar-link-detail">
                {updateState.phase === 'downloading'
                  ? u.sidebarDownloadingDetail
                  : updateState.phase === 'downloaded'
                    ? formatMessage(u.sidebarReadyDetail, { version: updateState.latestVersion || '' })
                    : u.sidebarAvailableDetail}
              </span>
            </span>
            {updateState.phase === 'downloading' && (
              <span className="sidebar-update-progress" aria-hidden="true">
                <span className="sidebar-update-progress-fill" style={{ width: `${updatePercent}%` }} />
              </span>
            )}
          </button>
        )}
        <a
          href="https://ko-fi.com/saadx25"
          target="_blank"
          rel="noreferrer noopener"
          className="sidebar-link sidebar-link-support"
          aria-label={s.supportAria}
        >
          <span className="sidebar-link-icon" aria-hidden="true"><Coffee size={18} /></span>
          <span className="sidebar-link-copy"><span className="sidebar-link-title">{s.supportTitle}</span><span className="sidebar-link-detail" dir="ltr">Ko-fi</span></span>
          <ArrowUpRight className="sidebar-link-arrow" size={15} aria-hidden="true" />
        </a>
        <a
          href="https://github.com/SAADX25"
          target="_blank"
          rel="noreferrer noopener"
          className="sidebar-link sidebar-link-github"
          aria-label={s.githubAria}
        >
          <span className="sidebar-link-icon" aria-hidden="true"><Github size={18} /></span>
          <span className="sidebar-link-copy"><span className="sidebar-link-title" dir="ltr">SAADX25</span><span className="sidebar-link-detail" dir="ltr">GitHub</span></span>
          <ArrowUpRight className="sidebar-link-arrow" size={15} aria-hidden="true" />
        </a>
      </div>
    </aside>
  )
}

export default Sidebar
