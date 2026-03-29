/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DownloadList — Container component for the downloads tab.
 *
 *  Responsibilities:
 *  ─ Reads the ordered task ID list from the store
 *  ─ Handles search filtering (by title match on the store)
 *  ─ Renders bulk action buttons (pause all, resume all, clear)
 *  ─ Maps taskIds → <DownloadCard /> instances
 *
 *  This component only re-renders when the ID list or search query changes,
 *  NOT when individual task progress updates.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import React, { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { useTaskIds, getTasksSnapshot } from '../stores/downloadStore'
import DownloadCard from './DownloadCard'
import type { Language } from '../translations'
import { translations } from '../translations'

interface DownloadListProps {
  lang: Language
  onOpenFile: (filePath: string, title?: string) => void
  onOpenFolder: (filePath: string) => void
  onDelete: (id: string, deleteFile: boolean) => void
  onError: (msg: string) => void
}

const DownloadList: React.FC<DownloadListProps> = (props) => {
  const { lang, onOpenFile, onOpenFolder, onDelete, onError } = props
  const t = translations[lang]
  const taskIds = useTaskIds()
  const [searchQuery, setSearchQuery] = useState('')

  // Filter task IDs by search query.
  // We read the full map snapshot only when filtering (not subscribed).
  const filteredIds = useMemo(() => {
    if (!searchQuery.trim()) return taskIds
    const q = searchQuery.toLowerCase()
    const tasks = getTasksSnapshot()
    return taskIds.filter((id) => {
      const task = tasks.get(id)
      if (!task) return false
      return (
        (task.title || task.filename || '').toLowerCase().includes(q) ||
        (task.url || '').toLowerCase().includes(q)
      )
    })
  }, [taskIds, searchQuery])

  const totalCount = taskIds.length

  return (
    <div className="tab-content fade-in">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="content-header flex-col" style={{ flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
        <div style={{ width: '100%', textAlign: 'left' }}>
          <h1>{t.downloads_title}</h1>
          <p className="muted">{t.total_tasks}: {totalCount}</p>
        </div>

        {/* Search bar */}
        <div className="search-bar-centered" style={{ width: '100%', display: 'flex', justifyContent: 'center', margin: '1rem 0' }}>
          <div className="search-bar-container" style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
            <input
              type="text"
              placeholder={t.search_placeholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input-centered"
            />
            {searchQuery && (
              <button
                className="clear-search-btn"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '15px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#999',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '4px',
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Task Grid ───────────────────────────────────────────── */}
      <section className="downloads-list">
        <div className="task-grid">
          {filteredIds.map((id) => (
            <DownloadCard
              key={id}
              id={id}
              lang={lang}
              onOpenFile={onOpenFile}
              onOpenFolder={onOpenFolder}
              onDelete={onDelete}
              onError={onError}
            />
          ))}
        </div>

        {/* Empty state */}
        {totalCount === 0 && (
          <div className="empty-state">
            <div className="empty-icon">📥</div>
            <h3>{t.empty_title}</h3>
            <p>{t.empty_subtitle}</p>
          </div>
        )}
      </section>
    </div>
  )
}

export default React.memo(DownloadList)
