// Bootstraps download store IPC listeners, URL-change form resets, and window drag-and-drop URL capture.
import { useEffect } from 'react'
import { initDownloadStore } from '../stores/downloadStore'
import { useUIStore } from '../stores/useUIStore'
import { useFormStore } from '../stores/useFormStore'

export function useDownloadInit(): void {
  const setUrl = useUIStore((s) => s.setUrl)
  const setActiveTab = useUIStore((s) => s.setActiveTab)

  useEffect(() => {
    const disposeStore = initDownloadStore()
    // Reset per-URL form selections whenever the active URL changes from any source.
    const unsubscribe = useUIStore.subscribe((state, previous) => {
      if (state.url !== previous.url) useFormStore.getState().resetForNewUrl()
    })
    return () => { unsubscribe(); disposeStore() }
  }, [])

  useEffect(() => {
    // Accept dragged HTTP links anywhere in the window and switch straight to the Add tab.
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
