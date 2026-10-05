import { useEffect } from 'react'
import { initDownloadStore } from '../stores/downloadStore'
import { useUIStore } from '../stores/useUIStore'
import { useFormStore } from '../stores/useFormStore'

/**
 * One-time side-effect wiring for the download workflow: starts the
 * high-frequency IPC listeners backing the download store, resets the
 * per-analysis form fields whenever the URL changes, and wires up global
 * drag & drop. Call exactly once, near the app root (see `App.tsx`).
 */
export function useDownloadInit(): void {
  const url = useUIStore((s) => s.url)
  const setAnalyzeResult = useUIStore((s) => s.setAnalyzeResult)
  const setUrl = useUIStore((s) => s.setUrl)
  const setActiveTab = useUIStore((s) => s.setActiveTab)
  const resetForNewUrl = useFormStore((s) => s.resetForNewUrl)

  useEffect(() => {
    const disposeStore = initDownloadStore()
    return () => { disposeStore() }
  }, [])

  
  useEffect(() => {
    setAnalyzeResult(null)
    resetForNewUrl()
    
  }, [setAnalyzeResult, resetForNewUrl, url])

  
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }
    const handleDrop = (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation()
      const droppedText = e.dataTransfer?.getData('text') || e.dataTransfer?.getData('url')
      if (droppedText && droppedText.startsWith('http')) {
        setUrl(droppedText)
        setActiveTab('add')
      }
    }
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
    
  }, [setActiveTab, setUrl])
}
