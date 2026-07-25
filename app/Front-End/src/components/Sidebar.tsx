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
  const activeDownloadCount = useDownloadStore(
    (s) => Array.from(s.tasks.values()).filter((t) => t.status === 'downloading').length
  )

  const navItems: Array<{ id: 'add' | 'downloads' | 'settings'; label: string; icon: any; badge?: number }> = [
    { id: 'add', label: t.nav_add, icon: Plus },
    { id: 'downloads', label: t.nav_downloads, icon: DownloadCloud, badge: activeDownloadCount },
    { id: 'settings', label: t.nav_settings, icon: Settings },
  ]

  return (
    <aside className="sidebar">
      <div className="brand flex items-center justify-center">
        <h1 className="cortex-logo-text">Cortex DL</h1>
      </div>
      
      <nav className="nav-menu">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              className={`nav-item relative ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className="absolute inset-0 bg-sky-500/10 border border-sky-400/30 rounded-xl"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="nav-icon relative z-10">
                <Icon size={20} />
              </span>
              <span className="nav-text relative z-10">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <motion.span
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  key={item.badge}
                  className="nav-badge relative z-10"
                >
                  {item.badge}
                </motion.span>
              )}
            </button>
          )
        })}
      </nav>

      <a
        href="https://github.com/SAADX25"
        target="_blank"
        rel="noreferrer"
        title="Developed by SAADX25"
        className="dev-badge"
      >
        <Github className="dev-badge-icon" />
        <span className="dev-badge-label">SAADX25</span>
      </a>
    </aside>
  )
}

export default Sidebar
