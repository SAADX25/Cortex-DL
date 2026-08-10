import React, { useState, useEffect } from 'react'
import { X, ClipboardPaste } from 'lucide-react'

/**
 * URL input bar — paste & go, or type a URL and analyze.
 * Memoized to avoid unnecessary re-renders from parent state changes.
 * Keeps its own local draft state so keystrokes never bounce through the
 * global store (and therefore never trigger unrelated re-renders elsewhere).
 */
export const UrlInputBar = React.memo((
  {
    analyzing,
    batchCount,
    maxBatchItems,
    placeholderText,
    pasteAndGoText,
    onPasteAndAnalyze,
    onAnalyze,
    onClear,
    initialUrl = '',
  }: {
    analyzing: boolean
    batchCount: number
    maxBatchItems: number
    placeholderText: string
    pasteAndGoText: string
    onPasteAndAnalyze: () => void
    onAnalyze: (url: string) => void
    onClear: () => void
    initialUrl?: string
  }
) => {
  const [localUrl, setLocalUrl] = useState(initialUrl)

  useEffect(() => {
    setLocalUrl(initialUrl)
  }, [initialUrl])

  return (
    <div className="hero-input-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
      <input
        className="hero-input"
        value={localUrl}
        onChange={(e) => setLocalUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && localUrl.trim() && !analyzing) onAnalyze(localUrl) }}
        placeholder={batchCount >= maxBatchItems ? `Batch full (${maxBatchItems}/${maxBatchItems}). Start download to clear.` : placeholderText}
        dir="auto"
        aria-label="URL input"
      />
      {localUrl && (
        <button
          className="hero-clear-btn"
          onClick={() => { setLocalUrl(''); onClear() }}
          aria-label="Clear URL"
        >
          <X size={20} />
        </button>
      )}
      <button
        className="hero-action-btn"
        onClick={localUrl.trim().length === 0 ? onPasteAndAnalyze : () => onAnalyze(localUrl)}
        disabled={analyzing}
        aria-label={localUrl.trim().length === 0 ? pasteAndGoText : 'Analyze URL'}
      >
        {analyzing ? (
          <div className="spinner-sm"></div>
        ) : localUrl.trim().length === 0 ? (
          <>
            <ClipboardPaste size={20} />
            <span>{pasteAndGoText}</span>
          </>
        ) : (
          <>
            <span>🔍</span>
            <span>Analyze</span>
          </>
        )}
      </button>
    </div>
  )
})
UrlInputBar.displayName = 'UrlInputBar'

export default UrlInputBar
