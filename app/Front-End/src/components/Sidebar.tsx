import React from 'react'
import { Language, translations } from '../translations'

interface SidebarProps {
  activeTab: 'add' | 'downloads' | 'settings'
  setActiveTab: (tab: 'add' | 'downloads' | 'settings') => void
  activeDownloadCount: number
  enginesStatus: { ytdlp: boolean; ffmpeg: boolean; jsRuntime: boolean; jsRuntimeName: string }
  lang: Language
}

const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  activeDownloadCount,
  enginesStatus,
  lang,
}) => {
  const t = translations[lang]

  return (
    <aside className="sidebar">
      <div className="brand flex items-center justify-center">
        <h1 className="cortex-logo-text">Cortex DL</h1>
      </div>
      
      <nav className="nav-menu">
        <button className={`nav-item ${activeTab === 'add' ? 'active' : ''}`} onClick={() => setActiveTab('add')}>
          <span className="nav-icon">➕</span>
          <span className="nav-text">{t.nav_add}</span>
        </button>
        <button className={`nav-item ${activeTab === 'downloads' ? 'active' : ''}`} onClick={() => setActiveTab('downloads')}>
          <span className="nav-icon">📥</span>
          <span className="nav-text">{t.nav_downloads}</span>
          {activeDownloadCount > 0 && (
            <span className="nav-badge">{activeDownloadCount}</span>
          )}
        </button>
        <button className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <span className="nav-icon">⚙️</span>
          <span className="nav-text">{t.nav_settings}</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className={`status-dot ${enginesStatus.ytdlp && enginesStatus.ffmpeg && enginesStatus.jsRuntime ? 'online' : 'offline'}`}></div>
        <div className="status-details">
          <div className="status-main">
            {enginesStatus.ytdlp && enginesStatus.ffmpeg && enginesStatus.jsRuntime 
              ? t.engine_ready 
              : (!enginesStatus.ytdlp ? t.engine_missing_ytdlp : !enginesStatus.ffmpeg ? t.engine_missing_ffmpeg : 'JS Runtime Missing')}
          </div>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
