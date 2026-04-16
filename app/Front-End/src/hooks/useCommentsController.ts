/**
 *  useCommentsController — Comments extraction domain.
 *
 *  Owns:
 *  ─ IPC listeners for comments extraction started / progress
 *  ─ Local state: downloading flag, success path, progress counters
 *
 *  This is the smallest, most self-contained controller hook.
 */
import { useState, useEffect } from 'react'

// 
export function useCommentsController() {
  const [isCommentsDownloading, setIsCommentsDownloading] = useState(false)
  const [commentsSuccessPath, setCommentsSuccessPath] = useState<string | null>(null)
  const [commentsProgress, setCommentsProgress] = useState<{ current: number; total: number } | null>(null)

  // Comments IPC listeners
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

  // 
  return {
    isCommentsDownloading, setIsCommentsDownloading,
    commentsSuccessPath, setCommentsSuccessPath,
    commentsProgress,
  }
}
