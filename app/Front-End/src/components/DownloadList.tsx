// Filterable, searchable downloads queue with bulk history/file cleanup modal
import React, { useState, useMemo, useRef, useEffect } from 'react'
import { X, Trash2, DownloadCloud, Search, Plus, CheckCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDownloadSnapshot, useDownloadStore } from '../stores/downloadStore'
import { useUIStore } from '../stores/useUIStore'
import { useLang } from '../stores/useSettingsStore'
import { useDebounce } from '../hooks/useDebounce'
import { onOpenFile, onOpenFolder, onDelete } from '../actions/downloadActions'
import DownloadCard from './DownloadCard'
import { translations } from '../translations'
import { getProgressView } from '../../../Shared/progressModel'
import './DownloadList.css'

type DownloadFilter = 'all' | 'active' | 'completed' | 'paused' | 'error'

const DownloadList: React.FC = () => {
  const lang = useLang()
  const activeTab = useUIStore(s => s.activeTab)
  const playerOpen = useUIStore(s => !!s.mediaPlayerFile && !s.mediaPlayerFloating)
  const onError = useUIStore(s => s.setGlobalError)
  const t = translations[lang]
  const snapshot = useDownloadSnapshot()
  const taskIds = snapshot.ids

  const [searchInput, setSearchInput] = useState('')
  const [filter, setFilter] = useState<DownloadFilter>('all')
  const debouncedSearchQuery = useDebounce(searchInput, 300)

  const [showClearModal, setShowClearModal] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (activeTab !== 'downloads' || playerOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'k')
      ) {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchInput('')
        searchInputRef.current?.blur()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, playerOpen])

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

  const { filteredIds, counts } = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase()
    const { tasks, ids: taskIds } = snapshot
    const counts: Record<DownloadFilter, number> = {
      all: taskIds.length,
      active: 0,
      completed: 0,
      paused: 0,
      error: 0,
    }
    const filteredIds = taskIds.filter(id => {
      const task = tasks.get(id)
      if (!task) return false
      const phase = getProgressView(task).phase
      const category =
        phase === 'completed'
          ? 'completed'
          : phase === 'error'
            ? 'error'
            : phase === 'paused' || phase === 'pausing'
              ? 'paused'
              : phase === 'canceled'
                ? null
                : 'active'
      if (category) counts[category]++
      return (
        (filter === 'all' || category === filter) &&
        (!q ||
          (task.title || task.filename || '').toLowerCase().includes(q) ||
          (task.url || '').toLowerCase().includes(q))
      )
    })
    return { filteredIds, counts }
  }, [snapshot, debouncedSearchQuery, filter])

  const totalCount = taskIds.length
  const dl = t.downloads
  const filterLabels: Record<DownloadFilter, string> = dl.filters
  const resetFilters = () => {
    setSearchInput('')
    setFilter('all')
  }

  return (
    <div className="tab-content downloads-page fade-in" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header className="dl-header-pro">
        <div className="dl-heading-row">
          <div className="dl-title-section">
            <h1 className="dl-main-title">
              {dl.heading} <span className="dl-total-count">{totalCount}</span>
            </h1>
            <p className="dl-subtitle-muted">{dl.subtitle}</p>
          </div>
        </div>

        <div className="dl-toolbar-row">
          <div className="dl-search-box">
            <Search size={18} className="dl-search-icon" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t.search_placeholder}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="dl-search-input"
              aria-label={t.search_placeholder}
            />
            <AnimatePresence>
              {!searchInput && <span className="dl-kbd-hint">Ctrl K</span>}
            </AnimatePresence>
            <AnimatePresence>
              {searchInput && (
                <motion.button
                  className="dl-clear-btn"
                  onClick={() => {
                    setSearchInput('')
                    searchInputRef.current?.focus()
                  }}
                  aria-label={dl.clearSearch}
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

          <AnimatePresence>
            {totalCount > 0 && (
              <motion.button
                className="dl-clear-all-btn-pro"
                onClick={() => setShowClearModal(true)}
                title={dl.clearAll}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
              >
                <Trash2 size={16} />
                <span>{dl.clearAll}</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        <div className="dl-filter-row" role="group" aria-label={dl.filterGroupLabel}>
          {(Object.keys(filterLabels) as DownloadFilter[]).map(key => (
            <button
              key={key}
              type="button"
              className={`dl-filter ${filter === key ? 'selected' : ''}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {filterLabels[key]}
              <span>{counts[key]}</span>
            </button>
          ))}
        </div>
      </header>

      <AnimatePresence>
        {showClearModal && (
          <motion.div
            className="modal-overlay"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 1000,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={e => {
              if (e.target === e.currentTarget) setShowClearModal(false)
            }}
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
                textAlign: lang === 'ar' ? 'right' : 'left',
              }}
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1rem',
                  flexDirection: lang === 'ar' ? 'row-reverse' : 'row',
                }}
              >
                <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.4rem' }}>
                  {dl.clearModalTitle}
                </h2>
                <button
                  onClick={() => setShowClearModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: '6px',
                  }}
                  aria-label="Close modal"
                >
                  <X size={20} />
                </button>
              </div>

              <p
                style={{
                  color: '#94a3b8',
                  marginBottom: '2rem',
                  lineHeight: 1.5,
                  fontSize: '1rem',
                }}
              >
                {dl.clearModalDesc}
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
                    <h4>{dl.clearHistoryTitle}</h4>
                    <p>{dl.clearHistoryDesc}</p>
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
                    <h4>{dl.deleteFilesTitle}</h4>
                    <p>{dl.deleteFilesDesc}</p>
                  </div>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="downloads-list">
        <div className="task-grid">
          {filteredIds.map(id => (
            <DownloadCard
              key={id}
              id={id}
              onOpenFile={onOpenFile}
              onOpenFolder={onOpenFolder}
              onDelete={onDelete}
              onError={onError}
            />
          ))}
        </div>

        {filteredIds.length === 0 && (
          <motion.div
            className="dl-empty-state"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <div className="dl-empty-art" aria-hidden="true">
              <div className="dl-empty-sheet">
                <span />
                <span />
                <span />
              </div>
              <div className="dl-empty-symbol">
                {totalCount === 0 ? (
                  <DownloadCloud size={28} strokeWidth={1.7} />
                ) : (
                  <Search size={27} />
                )}
              </div>
            </div>
            <h3>{totalCount === 0 ? dl.emptyFirstTitle : dl.emptyMatchTitle}</h3>
            <p>{totalCount === 0 ? dl.emptyFirstDesc : dl.emptyMatchDesc}</p>
            <button
              type="button"
              className="dl-add-button"
              onClick={
                totalCount === 0 ? () => useUIStore.getState().setActiveTab('add') : resetFilters
              }
            >
              {totalCount === 0 ? <Plus size={18} /> : <X size={17} />}
              {totalCount === 0 ? dl.addLink : dl.showAll}
            </button>
            {totalCount === 0 && (
              <span className="dl-empty-note">
                <CheckCheck size={14} />
                {dl.emptyNote}
              </span>
            )}
          </motion.div>
        )}
      </section>
    </div>
  )
}

export default React.memo(DownloadList)
