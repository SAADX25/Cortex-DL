import React from 'react'
import { Plus, DownloadCloud, Settings, Github } from 'lucide-react'
import { motion } from 'framer-motion'
import { Language, translations } from '../translations'
import { useUIStore } from '../stores/useUIStore'
import { useDownloadStore } from '../stores/downloadStore'

interface SidebarProps {
  lang: Language
}

const Sidebar: React.FC<SidebarProps> = ({ lang }) => {
  const t = translations[lang]

  const activeTab = useUIStore((s) => s.activeTab)
  const setActiveTab = useUIStore((s) => s.setActiveTab)

  const taskIds = useDownloadStore((s) => s.taskIds)
  const tasks   = useDownloadStore((s) => s.tasks)

  const activeCount = taskIds.filter((id) => {
    const task = tasks.get(id)
    return task && (task.status === 'downloading' || task.status === 'queued' || task.status === 'converting')
  }).length

  const totalCount  = taskIds.length
  const badgeCount  = activeCount > 0 ? activeCount : totalCount

  const navItems: Array<{
    id: 'add' | 'downloads' | 'settings'
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
      ariaLabel: lang === 'ar' ? 'إضافة تنزيل' : 'Add download',
    },
    {
      id: 'downloads',
      label: t.nav_downloads,
      icon: DownloadCloud,
      badge: badgeCount,
      isActiveBadge: activeCount > 0,
      ariaLabel: lang === 'ar' ? `التنزيلات، ${badgeCount} عنصر` : `Downloads, ${badgeCount} items`,
    },
    {
      id: 'settings',
      label: t.nav_settings,
      icon: Settings,
      ariaLabel: lang === 'ar' ? 'الإعدادات' : 'Settings',
    },
  ]

  return (
    <aside className="sidebar" role="complementary" aria-label={lang === 'ar' ? 'الشريط الجانبي' : 'Sidebar'}>
      {/* Brand */}
      <div className="brand">
        <h1 className="cortex-logo-text">Cortex DL</h1>
      </div>

      {/* Navigation */}
      <nav className="nav-menu" role="navigation" aria-label={lang === 'ar' ? 'التنقل الرئيسي' : 'Main navigation'}>
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

      {/* Developer badge */}
      <a
        href="https://github.com/SAADX25"
        target="_blank"
        rel="noreferrer noopener"
        title="Developed by SAADX25"
        className="dev-badge"
        aria-label="GitHub profile of SAADX25 (opens in new tab)"
      >
        <Github className="dev-badge-icon" aria-hidden="true" />
        <span className="dev-badge-label">SAADX25</span>
      </a>
    </aside>
  )
}

export default Sidebar
