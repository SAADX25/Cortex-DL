import React, { useState, useMemo, useRef, useEffect } from 'react'
import { X, Trash2, DownloadCloud, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTaskIds, getTasksSnapshot, useDownloadStore } from '../stores/downloadStore'
import { useUIStore } from '../stores/useUIStore'
import { useDebounce } from '../hooks/useDebounce'
import DownloadCard from './DownloadCard'
import type { Language } from '../translations'
import { translations } from '../translations'

interface DownloadListProps {
  lang: Language
  onOpenFile: (filePath: string, title?: string) => void
  onOpenFolder: (filePath: string) => void
  onDelete: (id: string, deleteFile: boolean) => void
}



const DownloadList: React.FC<DownloadListProps> = (props) => {
  const { lang, onOpenFile, onOpenFolder, onDelete } = props
  const onError = useUIStore((s) => s.setGlobalError)
  const t = translations[lang]
  const taskIds = useTaskIds()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearchQuery = useDebounce(searchInput, 300)

  const [showClearModal, setShowClearModal] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Keyboard shortcuts: Ctrl+F / Ctrl+K to focus search, Esc to clear & blur
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchInput('')
        searchInputRef.current?.blur()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleClearAll = async (deleteFiles: boolean) => {
    setShowClearModal(false)
    const currentTaskIds = [...taskIds]
    for (const id of currentTaskIds) {
      try {
        await window.cortexDl.deleteDownload(id, deleteFiles)
        useDownloadStore.getState().removeTask(id)
      } catch (err) {
        console.error('Failed to clear download', id, err)
      }
    }
  }

  const filteredIds = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return taskIds
    const q = debouncedSearchQuery.toLowerCase()
    const tasks = getTasksSnapshot()
    return taskIds.filter((id) => {
      const task = tasks.get(id)
      if (!task) return false
      return (
        (task.title || task.filename || '').toLowerCase().includes(q) ||
        (task.url || '').toLowerCase().includes(q)
      )
    })
  }, [taskIds, debouncedSearchQuery])

  const totalCount = taskIds.length

  return (
    <div className="tab-content fade-in">
      {/* ── Professional Sticky Header & Interactive Search Toolbar ── */}
      <header className="dl-header-pro">
        {/* Top: Title and Subtitle under each other */}
        <div className="dl-title-section">
          <h1 className="dl-main-title">{t.downloads_title}</h1>
          <p className="dl-subtitle-muted">{t.total_tasks}: {totalCount}</p>
        </div>

        {/* Bottom: Search Bar + Clear All Button Row */}
        <div className="dl-toolbar-row">
          {/* Interactive Glassmorphic Search Bar */}
          <div className="dl-search-box">
            <Search size={18} className="dl-search-icon" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t.search_placeholder}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="dl-search-input"
              aria-label={t.search_placeholder}
            />
            <AnimatePresence>
              {!searchInput && (
                <span className="dl-kbd-hint">Ctrl K</span>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {searchInput && (
                <motion.button
                  className="dl-clear-btn"
                  onClick={() => {
                    setSearchInput('')
                    searchInputRef.current?.focus()
                  }}
                  aria-label="Clear search"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                >
                  <X size={15} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Clear All Button */}
          <AnimatePresence>
            {totalCount > 0 && (
              <motion.button
                className="dl-clear-all-btn-pro"
                onClick={() => setShowClearModal(true)}
                title={lang === 'ar' ? 'مسح الكل' : 'Clear All'}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
              >
                <Trash2 size={16} />
                <span>{lang === 'ar' ? 'مسح الكل' : 'Clear All'}</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* Clear All Modal */}
      <AnimatePresence>
        {showClearModal && (
          <motion.div
            className="modal-overlay"
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 1000
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowClearModal(false) }}
          >
            <motion.div
              style={{
                backgroundColor: 'var(--bg-card)',
                padding: '2rem',
                borderRadius: '16px',
                maxWidth: '450px',
                width: '90%',
                boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.1)',
                textAlign: lang === 'ar' ? 'right' : 'left'
              }}
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexDirection: lang === 'ar' ? 'row-reverse' : 'row' }}>
                <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.4rem' }}>
                  {lang === 'ar' ? 'مسح التنزيلات' : 'Clear Downloads'}
                </h2>
                <button
                  onClick={() => setShowClearModal(false)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', borderRadius: '6px' }}
                  aria-label="Close modal"
                >
                  <X size={20} />
                </button>
              </div>

              <p style={{ color: '#94a3b8', marginBottom: '2rem', lineHeight: 1.5, fontSize: '1rem' }}>
                {lang === 'ar'
                  ? 'كيف تريد مسح سجل التنزيلات الخاص بك؟ يرجى اختيار أحد الخيارات أدناه.'
                  : 'How would you like to clear your download history? Please choose an option below.'}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <button
                  className="dl-modal-option-btn primary"
                  onClick={() => handleClearAll(false)}
                  style={{ flexDirection: lang === 'ar' ? 'row-reverse' : 'row' }}
                >
                  <div className="dl-modal-option-icon primary">
                    <Trash2 size={20} />
                  </div>
                  <div>
                    <h4>{lang === 'ar' ? 'حذف من السجل فقط' : 'Clear History Only'}</h4>
                    <p>{lang === 'ar' ? 'مسح القائمة من التطبيق فقط والاحتفاظ بالملفات على جهازك.' : 'Remove from the list but keep files on your computer.'}</p>
                  </div>
                </button>

                <button
                  className="dl-modal-option-btn danger"
                  onClick={() => handleClearAll(true)}
                  style={{ flexDirection: lang === 'ar' ? 'row-reverse' : 'row' }}
                >
                  <div className="dl-modal-option-icon danger">
                    <Trash2 size={20} />
                  </div>
                  <div>
                    <h4>{lang === 'ar' ? 'حذف الملفات بشكل نهائي' : 'Delete Files Permanently'}</h4>
                    <p>{lang === 'ar' ? 'مسح القائمة وحذف جميع الملفات التي تم تنزيلها من جهازك.' : 'Remove from the list and delete all downloaded files from your device.'}</p>
                  </div>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Downloads list */}
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

        {/* Empty state: No downloads exist */}
        {totalCount === 0 && (
          <motion.div
            className="empty-state"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <div className="empty-icon-container">
              <DownloadCloud size={48} strokeWidth={1.5} className="empty-icon-svg" />
            </div>
            <h3>{t.empty_title}</h3>
            <p>{t.empty_subtitle}</p>
          </motion.div>
        )}
      </section>
    </div>
  )
}

export default React.memo(DownloadList)
