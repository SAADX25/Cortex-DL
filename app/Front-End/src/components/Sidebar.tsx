import React from 'react'
import { Plus, DownloadCloud, Settings } from 'lucide-react'
import { Language, translations } from '../translations'
import { useUIStore } from '../stores/useUIStore'
import { useDownloadStore } from '../stores/downloadStore'

interface SidebarProps {
  lang: Language
}

const Sidebar: React.FC<SidebarProps> = ({
  lang,
}) => {
  const t = translations[lang]

  // Subscribe directly to the store — only re-renders when these slices change
  const activeTab = useUIStore((s) => s.activeTab)
  const setActiveTab = useUIStore((s) => s.setActiveTab)
  const activeDownloadCount = useDownloadStore(
    (s) => Array.from(s.tasks.values()).filter((t) => t.status === 'downloading').length
  )

  return (
    <aside className="sidebar">
      <div className="brand flex items-center justify-center">
        <h1 className="cortex-logo-text">Cortex DL</h1>
      </div>
      
      <nav className="nav-menu">
        <button className={`nav-item ${activeTab === 'add' ? 'active' : ''}`} onClick={() => setActiveTab('add')}>
          <span className="nav-icon"><Plus size={20} /></span>
          <span className="nav-text">{t.nav_add}</span>
        </button>
        <button className={`nav-item ${activeTab === 'downloads' ? 'active' : ''}`} onClick={() => setActiveTab('downloads')}>
          <span className="nav-icon"><DownloadCloud size={20} /></span>
          <span className="nav-text">{t.nav_downloads}</span>
          {activeDownloadCount > 0 && (
            <span className="nav-badge">{activeDownloadCount}</span>
          )}
        </button>
        <button className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <span className="nav-icon"><Settings size={20} /></span>
          <span className="nav-text">{t.nav_settings}</span>
        </button>
      </nav>
    </aside>
  )
}

export default Sidebar
