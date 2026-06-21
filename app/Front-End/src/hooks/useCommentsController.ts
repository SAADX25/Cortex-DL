import { useState, useEffect } from 'react'


export function useCommentsController() {
  const [isCommentsDownloading, setIsCommentsDownloading] = useState(false)
  const [commentsSuccessPath, setCommentsSuccessPath] = useState<string | null>(null)
  const [commentsProgress, setCommentsProgress] = useState<{ current: number; total: number } | null>(null)

  
  useEffect(() => {
    let cleanupStarted: (() => void) | undefined
    let cleanupProgress: (() => void) | undefined

    if (window.cortexDl.onCommentsExtractionStarted) {
      cleanupStarted = window.cortexDl.onCommentsExtractionStarted(() => {
        setCommentsProgress(null)
        setCommentsSuccessPath(null)
        setIsCommentsDownloading(true)
      })
    }

    if (window.cortexDl.onCommentsProgress) {
      cleanupProgress = window.cortexDl.onCommentsProgress((current, total) => {
        setCommentsProgress({ current, total })
      })
    }

    return () => {
      cleanupStarted && cleanupStarted()
      cleanupProgress && cleanupProgress()
    }
  }, [])

  
  return {
    isCommentsDownloading, setIsCommentsDownloading,
    commentsSuccessPath, setCommentsSuccessPath,
    commentsProgress,
  }
}
