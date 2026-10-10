import React, { useState, useMemo } from 'react'
import { CheckCheck, ListMusic, ListChecks, Minus, Music2, Search, Trash2, X, AlertTriangle } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { type Language } from '../../translations'
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

const PlaylistView: React.FC<PlaylistViewProps> = ({ analyzeResult, lang, MAX_BATCH_ITEMS, SmartImage,
  removeAnalyzedPlaylistVideo, togglePlaylistItemSelected, selectAllPlaylistItems, deselectAllPlaylistItems, clearPlaylistItems }) => {
  const ar = lang === 'ar'
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 200).trim()
  const filteredItems = useMemo(() => {
    const query = debouncedSearch.toLocaleLowerCase()
    return analyzeResult.items.map((item: any, originalIndex: number) => ({ item, originalIndex }))
      .filter(({ item }: any) => !query || item.title?.toLocaleLowerCase().includes(query))
  }, [analyzeResult.items, debouncedSearch])
  const selectedCount = analyzeResult.items.filter((item: any) => item.selected).length
  const overLimit = selectedCount > MAX_BATCH_ITEMS
  const visibleIndices = filteredItems.map(({ originalIndex }: any) => originalIndex)
  const visibleSelected = filteredItems.some(({ item }: any) => item.selected)
  const visibleUnselected = filteredItems.some(({ item }: any) => !item.selected)
  const selectFirstBatch = () => {
    deselectAllPlaylistItems()
    selectAllPlaylistItems(analyzeResult.items.slice(0, MAX_BATCH_ITEMS).map((_: any, index: number) => index))
  }

  return <section className="pl-panel" dir={ar ? 'rtl' : 'ltr'} aria-label={ar ? 'قائمة التشغيل' : 'Playlist'}>
    <header className="pl-header">
      <div className="pl-heading-icon"><ListMusic size={23} aria-hidden="true" /></div>
      <div className="pl-heading">
        <span className="pl-eyebrow">{ar ? 'قائمة التشغيل' : 'Playlist'}</span>
        <h3 title={analyzeResult.title}><bdi>{analyzeResult.title}</bdi></h3>
        <p>{ar ? `${analyzeResult.items.length} عنصر · حتى ${MAX_BATCH_ITEMS} عنصرًا في الدفعة` : `${analyzeResult.items.length} items · Up to ${MAX_BATCH_ITEMS} per batch`}</p>
      </div>
      <div className={`pl-selection${overLimit ? ' over-limit' : ''}`} aria-live="polite">
        <ListChecks size={16} aria-hidden="true" />
        <span><strong>{selectedCount}</strong> {ar ? 'محدد' : 'selected'}</span>
      </div>
    </header>

    <div className="pl-toolbar">
      <div className="pl-search">
        <Search size={17} aria-hidden="true" />
        <input type="search" value={searchQuery} onChange={event => setSearchQuery(event.target.value)}
          placeholder={ar ? 'ابحث في قائمة التشغيل…' : 'Search this playlist…'} aria-label={ar ? 'ابحث في قائمة التشغيل' : 'Search this playlist'} />
        {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label={ar ? 'مسح البحث' : 'Clear search'}><X size={15} /></button>}
      </div>
      <div className="pl-actions">
        <button type="button" className="pl-button" disabled={!visibleUnselected} onClick={() => selectAllPlaylistItems(visibleIndices)}>
          <CheckCheck size={16} aria-hidden="true" />{debouncedSearch ? (ar ? 'تحديد النتائج' : 'Select results') : (ar ? 'تحديد الكل' : 'Select all')}
        </button>
        <button type="button" className="pl-button" disabled={!visibleSelected} onClick={() => deselectAllPlaylistItems(visibleIndices)}>
          <Minus size={16} aria-hidden="true" />{ar ? 'إلغاء التحديد' : 'Deselect'}
        </button>
        <button type="button" className="pl-button pl-clear" disabled={!analyzeResult.items.length} onClick={clearPlaylistItems}>
          <Trash2 size={15} aria-hidden="true" />{ar ? 'مسح القائمة' : 'Clear list'}
        </button>
      </div>
    </div>

    {overLimit && <div className="pl-limit-note" role="status">
      <AlertTriangle size={18} aria-hidden="true" />
      <p>{ar ? `حدّد ${MAX_BATCH_ITEMS} عنصرًا أو أقل لبدء التنزيل.` : `Choose ${MAX_BATCH_ITEMS} items or fewer to start downloading.`}</p>
      <button type="button" onClick={selectFirstBatch}>{ar ? `تحديد أول ${MAX_BATCH_ITEMS}` : `Select first ${MAX_BATCH_ITEMS}`}</button>
    </div>}

    <div className="pl-items" tabIndex={0} aria-label={ar ? 'عناصر قائمة التشغيل' : 'Playlist items'}>
      {filteredItems.map(({ item, originalIndex }: any) => <div key={`${item.id}-${originalIndex}`} className={`pl-item${item.selected ? ' selected' : ''}`}>
        <span className="pl-item-index" aria-hidden="true">{originalIndex + 1}</span>
        <label className="pl-item-content">
          <input className="pl-checkbox" type="checkbox" checked={!!item.selected} onChange={() => togglePlaylistItemSelected(originalIndex)}
            aria-label={`${ar ? 'تحديد' : 'Select'} ${item.title || (ar ? `العنصر ${originalIndex + 1}` : `item ${originalIndex + 1}`)}`} />
          <span className="pl-thumb" aria-hidden="true">
            {item.thumbnail ? <SmartImage src={item.thumbnail} alt="" loading="lazy" decoding="async" /> : <Music2 size={23} />}
          </span>
          <span className="pl-item-title" title={item.title}><bdi>{item.title || (ar ? 'بدون عنوان' : 'Untitled')}</bdi></span>
        </label>
        <button type="button" className="pl-remove" onClick={() => removeAnalyzedPlaylistVideo(originalIndex)}
          title={ar ? 'إزالة من القائمة' : 'Remove from playlist'} aria-label={`${ar ? 'إزالة' : 'Remove'} ${item.title || originalIndex + 1}`}><X size={17} /></button>
      </div>)}
      {!filteredItems.length && <div className="pl-empty">
        {debouncedSearch ? <Search size={27} aria-hidden="true" /> : <ListMusic size={30} aria-hidden="true" />}
        <strong>{debouncedSearch ? (ar ? 'لا توجد نتائج' : 'No matches found') : (ar ? 'القائمة فارغة' : 'This playlist is empty')}</strong>
        <p>{debouncedSearch ? (ar ? 'جرّب اسمًا آخر أو امسح البحث.' : 'Try another title or clear your search.') : (ar ? 'حلّل رابط قائمة تشغيل لإضافة عناصر.' : 'Analyze a playlist link to add items.')}</p>
        {debouncedSearch && <button type="button" className="pl-button" onClick={() => setSearchQuery('')}>{ar ? 'مسح البحث' : 'Clear search'}</button>}
      </div>}
    </div>
    <footer className="pl-footer"><span>{ar ? `عرض ${filteredItems.length} من ${analyzeResult.items.length} عنصر` : `Showing ${filteredItems.length} of ${analyzeResult.items.length} items`}</span>
      <span>{ar ? 'حدّد العناصر التي تريد تنزيلها' : 'Select the items you want to download'}</span></footer>
  </section>
}

export default PlaylistView
