// Searchable playlist item picker capped by the batch concurrency limit
import React, { useState, useMemo } from 'react'
import {
  CheckCheck,
  ListMusic,
  ListChecks,
  Minus,
  Music2,
  Search,
  Trash2,
  X,
  AlertTriangle,
} from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { formatMessage, translations, type Language } from '../../translations'
import './PlaylistView.css'

interface PlaylistViewProps {
  analyzeResult: any
  lang: Language
  MAX_BATCH_ITEMS: number
  SmartImage: React.FC<any>
  removeAnalyzedPlaylistVideo: (index: number) => void
  togglePlaylistItemSelected: (index: number) => void
  selectAllPlaylistItems: (indices?: number[]) => void
  deselectAllPlaylistItems: (indices?: number[]) => void
  clearPlaylistItems: () => void
}

const PlaylistView: React.FC<PlaylistViewProps> = ({
  analyzeResult,
  lang,
  MAX_BATCH_ITEMS,
  SmartImage,
  removeAnalyzedPlaylistVideo,
  togglePlaylistItemSelected,
  selectAllPlaylistItems,
  deselectAllPlaylistItems,
  clearPlaylistItems,
}) => {
  const pl = translations[lang].playlist
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 200).trim()
  const filteredItems = useMemo(() => {
    const query = debouncedSearch.toLocaleLowerCase()
    return analyzeResult.items
      .map((item: any, originalIndex: number) => ({ item, originalIndex }))
      .filter(({ item }: any) => !query || item.title?.toLocaleLowerCase().includes(query))
  }, [analyzeResult.items, debouncedSearch])
  const selectedCount = analyzeResult.items.filter((item: any) => item.selected).length
  const overLimit = selectedCount > MAX_BATCH_ITEMS
  const visibleIndices = filteredItems.map(({ originalIndex }: any) => originalIndex)
  const visibleSelected = filteredItems.some(({ item }: any) => item.selected)
  const visibleUnselected = filteredItems.some(({ item }: any) => !item.selected)
  const selectFirstBatch = () => {
    deselectAllPlaylistItems()
    selectAllPlaylistItems(
      analyzeResult.items.slice(0, MAX_BATCH_ITEMS).map((_: any, index: number) => index),
    )
  }

  return (
    <section className="pl-panel" dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-label={pl.label}>
      <header className="pl-header">
        <div className="pl-heading-icon">
          <ListMusic size={23} aria-hidden="true" />
        </div>
        <div className="pl-heading">
          <span className="pl-eyebrow">{pl.label}</span>
          <h3 title={analyzeResult.title}>
            <bdi>{analyzeResult.title}</bdi>
          </h3>
          <p>
            {formatMessage(pl.summary, { count: analyzeResult.items.length, max: MAX_BATCH_ITEMS })}
          </p>
        </div>
        <div className={`pl-selection${overLimit ? ' over-limit' : ''}`} aria-live="polite">
          <ListChecks size={16} aria-hidden="true" />
          <span>
            <strong>{selectedCount}</strong> {pl.selected}
          </span>
        </div>
      </header>

      <div className="pl-toolbar">
        <div className="pl-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder={pl.searchPlaceholder}
            aria-label={pl.searchLabel}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} aria-label={pl.clearSearch}>
              <X size={15} />
            </button>
          )}
        </div>
        <div className="pl-actions">
          <button
            type="button"
            className="pl-button"
            disabled={!visibleUnselected}
            onClick={() => selectAllPlaylistItems(visibleIndices)}
          >
            <CheckCheck size={16} aria-hidden="true" />
            {debouncedSearch ? pl.selectResults : pl.selectAll}
          </button>
          <button
            type="button"
            className="pl-button"
            disabled={!visibleSelected}
            onClick={() => deselectAllPlaylistItems(visibleIndices)}
          >
            <Minus size={16} aria-hidden="true" />
            {pl.deselect}
          </button>
          <button
            type="button"
            className="pl-button pl-clear"
            disabled={!analyzeResult.items.length}
            onClick={clearPlaylistItems}
          >
            <Trash2 size={15} aria-hidden="true" />
            {pl.clearList}
          </button>
        </div>
      </div>

      {overLimit && (
        <div className="pl-limit-note" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <p>{formatMessage(pl.limitNote, { max: MAX_BATCH_ITEMS })}</p>
          <button type="button" onClick={selectFirstBatch}>
            {formatMessage(pl.selectFirst, { max: MAX_BATCH_ITEMS })}
          </button>
        </div>
      )}

      <div className="pl-items" tabIndex={0} aria-label={pl.itemsLabel}>
        {filteredItems.map(({ item, originalIndex }: any) => (
          <div
            key={`${item.id}-${originalIndex}`}
            className={`pl-item${item.selected ? ' selected' : ''}`}
          >
            <span className="pl-item-index" aria-hidden="true">
              {originalIndex + 1}
            </span>
            <label className="pl-item-content">
              <input
                className="pl-checkbox"
                type="checkbox"
                checked={!!item.selected}
                onChange={() => togglePlaylistItemSelected(originalIndex)}
                aria-label={`${pl.selectItem} ${item.title || formatMessage(pl.itemNumber, { n: originalIndex + 1 })}`}
              />
              <span className="pl-thumb" aria-hidden="true">
                {item.thumbnail ? (
                  <SmartImage src={item.thumbnail} alt="" loading="lazy" decoding="async" />
                ) : (
                  <Music2 size={23} />
                )}
              </span>
              <span className="pl-item-title" title={item.title}>
                <bdi>{item.title || pl.untitled}</bdi>
              </span>
            </label>
            <button
              type="button"
              className="pl-remove"
              onClick={() => removeAnalyzedPlaylistVideo(originalIndex)}
              title={pl.removeFromPlaylist}
              aria-label={`${pl.removeItem} ${item.title || originalIndex + 1}`}
            >
              <X size={17} />
            </button>
          </div>
        ))}
        {!filteredItems.length && (
          <div className="pl-empty">
            {debouncedSearch ? (
              <Search size={27} aria-hidden="true" />
            ) : (
              <ListMusic size={30} aria-hidden="true" />
            )}
            <strong>{debouncedSearch ? pl.noMatches : pl.empty}</strong>
            <p>{debouncedSearch ? pl.noMatchesHint : pl.emptyHint}</p>
            {debouncedSearch && (
              <button type="button" className="pl-button" onClick={() => setSearchQuery('')}>
                {pl.clearSearch}
              </button>
            )}
          </div>
        )}
      </div>
      <footer className="pl-footer">
        <span>
          {formatMessage(pl.showingCount, {
            shown: filteredItems.length,
            total: analyzeResult.items.length,
          })}
        </span>
        <span>{pl.footerHint}</span>
      </footer>
    </section>
  )
}

export default PlaylistView
