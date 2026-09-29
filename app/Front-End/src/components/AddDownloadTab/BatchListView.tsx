import React from 'react'
import CustomDropdown from '../CustomDropdown'
import { VIDEO_FORMATS, AUDIO_FORMATS } from '../../constants/formats'
import type { BatchItem } from '../AddDownloadTab'

interface BatchListViewProps {
  batchItems: BatchItem[]
  setBatchItems: React.Dispatch<React.SetStateAction<BatchItem[]>>
  SmartImage: React.FC<any>
}

const BatchListView: React.FC<BatchListViewProps> = ({
  batchItems,
  setBatchItems,
  SmartImage
}) => {
  if (batchItems.length === 0) return null

  return (
    <div className="batch-list fade-in" style={{ marginTop: 12, borderRadius: 8, background: '#0b1220', padding: 8 }}>
      {batchItems.map((item, idx) => {
        const isItemError = item.status === 'error'
        const isItemProcessing = item.status === 'processing'
        const isItemLocked = isItemProcessing || item.status === 'success'

        return (
          <div key={item.id} style={{
            display: 'flex', flexDirection: 'column',
            padding: '6px 8px',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
            borderLeft: isItemError ? '3px solid #ef4444' : isItemProcessing ? '3px solid #3b82f6' : '3px solid transparent',
            background: isItemError ? 'rgba(239, 68, 68, 0.06)' : isItemProcessing ? 'rgba(59, 130, 246, 0.04)' : 'transparent',
            transition: 'all 0.3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', overflow: 'hidden' }}>
                {isItemProcessing ? (
                  <div style={{ width: 56, height: 32, borderRadius: 6, background: '#081026', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="spinner-sm" style={{ width: 16, height: 16, borderWidth: 2 }}></div>
                  </div>
                ) : item.thumbnail ? (
                  <SmartImage src={item.thumbnail} alt="thumb" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: 6 }} />
                ) : item.loading ? (
                  <div style={{ width: 56, height: 32, borderRadius: 6, background: '#081026', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>⏳</div>
                ) : (
                  <div style={{ width: 56, height: 32, borderRadius: 6, background: '#081026', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isItemError ? '#f87171' : '#9ca3af' }}>
                    {isItemError ? '⚠️' : item.format === 'mp3' ? '🎵' : '🎬'}
                  </div>
                )}
                <div style={{ color: isItemError ? '#fca5a5' : '#d1d5db', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }} title={item.title || item.url}>
                  {item.title || (item.loading ? 'Loading...' : item.url)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isItemProcessing ? (
                  <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>Adding…</span>
                ) : (
                  <div style={{ minWidth: 92, display: 'flex', alignItems: 'center', opacity: isItemLocked ? 0.4 : 1, pointerEvents: isItemLocked ? 'none' : 'auto' }}>
                    <CustomDropdown
                      value={item.format}
                      onChange={(v) => setBatchItems(prev => prev.map(b => b.id === item.id ? { ...b, format: v as any } : b))}
                      groups={[
                        { label: 'Video', options: VIDEO_FORMATS },
                        { label: 'Audio', options: AUDIO_FORMATS }
                      ]}
                    />
                  </div>
                )}
                <button
                  className="batch-remove-btn"
                  onClick={() => setBatchItems(prev => prev.filter((_, i) => i !== idx))}
                  disabled={isItemProcessing}
                  style={{ opacity: isItemProcessing ? 0.3 : 1 }}
                >✕</button>
              </div>
            </div>
            {isItemError && item.errorMessage && (
              <div style={{ fontSize: 11, color: '#f87171', marginTop: 4, paddingLeft: 64, lineHeight: 1.3 }}>
                ⚠️ {item.errorMessage}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default BatchListView
