/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DownloadList — Container component for the downloads tab (optimized).
 *
 *  Responsibilities:
 *  ─ Reads the ordered task ID list from the store
 *  ─ Handles search filtering with DEBOUNCING (300ms delay)
 *  ─ Renders bulk action buttons (pause all, resume all, clear)
 *  ─ Maps taskIds → <DownloadCard /> instances
 *
 *  Performance:
 *  ─ Search input changes are debounced to prevent excessive filtering
 *  ─ Only re-filters when user stops typing for 300ms
 *  ─ This component only re-renders when the ID list or debounced search changes,
 *    NOT when individual task progress updates (handled by useHighFrequencyIPC).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import React, { useState, useMemo } from 'react'
import { X, Trash2, DownloadCloud } from 'lucide-react'
import { useTaskIds, getTasksSnapshot, useDownloadStore } from '../stores/downloadStore'
import { useDebounce } from '../hooks/useDebounce'
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
  
  // ── High-Performance Search with Debouncing ──────────────────────────────
  // User input is stored immediately (for responsive UI), but filtering is
  // debounced by 300ms to avoid re-filtering on every single keystroke.
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearchQuery = useDebounce(searchInput, 300)

  // Filter task IDs by search query.
  // We read the full map snapshot only when filtering (not subscribed).
  // This runs only when debouncedSearchQuery changes (max 3-4 times per second).
  const [showClearModal, setShowClearModal] = useState(false)

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
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="content-header flex-col sticky-search-header" style={{ flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
        <div style={{ width: '100%', textAlign: 'left' }}>
          <h1>{t.downloads_title}</h1>
          <p className="muted">{t.total_tasks}: {totalCount}</p>
        </div>

        {/* Search bar with debouncing */}
        <div className="search-bar-centered" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', margin: '1rem 0' }}>
          <div className="search-bar-container" style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
            <input
              type="text"
              placeholder={t.search_placeholder}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="search-input-centered"
            />
            {searchInput && (
              <button
                className="clear-search-btn"
                onClick={() => setSearchInput('')}
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
          
          {totalCount > 0 && (
            <button 
              className="btn btn-outline danger-hover"
              onClick={() => setShowClearModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1rem',
                borderRadius: '8px',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.05)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                flexShrink: 0
              }}
              title={lang === 'ar' ? 'مسح الكل' : 'Clear All'}
            >
              <Trash2 size={18} />
              <span style={{ fontWeight: 600 }}>{lang === 'ar' ? 'مسح الكل' : 'Clear All'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Modal for Clear All */}
      {showClearModal && (
        <div className="modal-overlay fade-in" style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="modal-content fade-scale" style={{
            backgroundColor: 'var(--bg-card)',
            padding: '2rem',
            borderRadius: '16px',
            maxWidth: '450px',
            width: '90%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.1)',
            textAlign: lang === 'ar' ? 'right' : 'left'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexDirection: lang === 'ar' ? 'row-reverse' : 'row' }}>
              <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.4rem' }}>
                {lang === 'ar' ? 'مسح التنزيلات' : 'Clear Downloads'}
              </h2>
              <button 
                onClick={() => setShowClearModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
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
                className="btn"
                onClick={() => handleClearAll(false)}
                style={{
                  backgroundColor: 'rgba(56, 189, 248, 0.1)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '1rem',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  textAlign: lang === 'ar' ? 'right' : 'left',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  flexDirection: lang === 'ar' ? 'row-reverse' : 'row'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.2)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.1)'}
              >
                <div style={{ padding: '8px', backgroundColor: 'rgba(56,189,248,0.2)', borderRadius: '8px', marginTop: '-2px' }}>
                  <Trash2 size={20} />
                </div>
                <div>
                  <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '1.1rem' }}>
                    {lang === 'ar' ? 'حذف من السجل فقط' : 'Clear History Only'}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.8 }}>
                    {lang === 'ar' ? 'مسح القائمة من التطبيق فقط والاحتفاظ بالملفات على جهازك.' : 'Remove from the list but keep files on your computer.'}
                  </p>
                </div>
              </button>

              <button 
                className="btn danger-hover"
                onClick={() => handleClearAll(true)}
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  padding: '1rem',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  textAlign: lang === 'ar' ? 'right' : 'left',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  flexDirection: lang === 'ar' ? 'row-reverse' : 'row'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
              >
                <div style={{ padding: '8px', backgroundColor: 'rgba(239,68,68,0.2)', borderRadius: '8px', marginTop: '-2px' }}>
                  <Trash2 size={20} />
                </div>
                <div>
                  <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '1.1rem' }}>
                    {lang === 'ar' ? 'حذف الملفات بشكل نهائي' : 'Delete Files Permanently'}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.8 }}>
                    {lang === 'ar' ? 'مسح القائمة وحذف جميع الملفات التي تم تنزيلها من جهازك.' : 'Remove from the list and delete all downloaded files from your device.'}
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

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
          <div className="empty-state fade-in">
            <div className="empty-icon-container">
              <DownloadCloud size={48} strokeWidth={1.5} className="empty-icon-svg" />
            </div>
            <h3>{t.empty_title}</h3>
            <p>{t.empty_subtitle}</p>
          </div>
        )}
      </section>
    </div>
  )
}

export default React.memo(DownloadList)
