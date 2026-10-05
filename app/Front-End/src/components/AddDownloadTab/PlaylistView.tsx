import React, { useState, useMemo } from 'react'
import { CheckSquare, Square, Trash2, Search } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { translations, Language } from '../../translations'

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
  clearPlaylistItems
}) => {
  const t = translations[lang]
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)

  const filteredPlaylistItems = useMemo(() => {
    if (analyzeResult?.kind !== 'playlist' || !analyzeResult.items) return []
    const itemsWithIndex = analyzeResult.items.map((item: any, originalIndex: number) => ({ item, originalIndex }))
    if (!debouncedSearch) return itemsWithIndex
    const lowerQ = debouncedSearch.toLowerCase()
    return itemsWithIndex.filter(({ item }: any) => item.title?.toLowerCase().includes(lowerQ))
  }, [analyzeResult, debouncedSearch])

  const handleSelectAllVisible = () => {
    if (filteredPlaylistItems.length > 0) {
      selectAllPlaylistItems(filteredPlaylistItems.map(({ originalIndex }: any) => originalIndex))
    }
  }

  const handleDeselectAllVisible = () => {
    if (filteredPlaylistItems.length > 0) {
      deselectAllPlaylistItems(filteredPlaylistItems.map(({ originalIndex }: any) => originalIndex))
    }
  }

  const selectedCount = analyzeResult.items.filter((i: any) => i.selected).length

  return (
    <div className="playlist-preview">
      <div className="playlist-header">
        <h3>🎬 {t.playlist_title}: {analyzeResult.title}</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="badge" style={{ backgroundColor: selectedCount > MAX_BATCH_ITEMS ? '#ef4444' : undefined }}>
            {selectedCount > MAX_BATCH_ITEMS 
              ? `${selectedCount} / ${MAX_BATCH_ITEMS} Max Selected`
              : `${selectedCount} Selected`}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', padding: '0 8px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={handleSelectAllVisible} style={{ background: '#3b82f6', color: 'white', padding: '4px 12px', borderRadius: '4px', fontSize: '13px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Select All</button>
          <button onClick={handleDeselectAllVisible} style={{ background: 'rgba(255,255,255,0.1)', color: 'white', padding: '4px 12px', borderRadius: '4px', fontSize: '13px', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Deselect All</button>
          <button onClick={clearPlaylistItems} style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '4px 12px', borderRadius: '4px', fontSize: '13px', border: 'none', cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Trash2 size={14} /> Clear List
          </button>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: '150px', maxWidth: '300px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', color: '#9ca3af' }} />
          <input 
            type="text" 
            placeholder="Search..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: '#fff',
              padding: '6px 10px 6px 30px',
              fontSize: '13px',
              outline: 'none'
            }}
          />
        </div>
      </div>

      {selectedCount > MAX_BATCH_ITEMS && (
        <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '8px', padding: '0 8px', fontWeight: 500 }}>
          ⚠️ {lang === 'ar' ? `يجب إزالة ${selectedCount - MAX_BATCH_ITEMS} ملفات للبدء بالتحميل` : `Please deselect ${selectedCount - MAX_BATCH_ITEMS} items to start downloading`}
        </div>
      )}
      <div className="playlist-items custom-scrollbar" style={{ maxHeight: 300, overflowY: 'auto', paddingRight: 6 }}>
        {filteredPlaylistItems.map(({ item, originalIndex }: any) => (
          <div key={`${item.id}-${originalIndex}`} className="playlist-item" style={{ opacity: item.selected ? 1 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: 6, transition: 'background 0.2s, opacity 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', cursor: 'pointer', flex: 1 }} onClick={() => togglePlaylistItemSelected(originalIndex)}>
              <div style={{ color: item.selected ? '#3b82f6' : '#9ca3af', display: 'flex', alignItems: 'center' }}>
                {item.selected ? <CheckSquare size={18} /> : <Square size={18} />}
              </div>
              {item.thumbnail && <SmartImage src={item.thumbnail} alt="thumbnail" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: '4px' }} />}
              <span title={item.title} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#d1d5db', fontSize: 13 }}>{item.title}</span>
            </div>
            <button
              onClick={() => removeAnalyzedPlaylistVideo(originalIndex)}
              style={{
                background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer',
                padding: '4px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.backgroundColor = 'transparent' }}
              title={t.btn_remove || "Remove"}
            >
              ✕
            </button>
          </div>
        ))}
        {filteredPlaylistItems.length === 0 && debouncedSearch && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: '13px' }}>
            {`No results found for "${debouncedSearch}"`}
          </div>
        )}
      </div>
    </div>
  )
}

export default PlaylistView
