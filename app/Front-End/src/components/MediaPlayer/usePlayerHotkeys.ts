// Keyboard shortcut listener for MediaPlayerModal (main window and floating pop-out window)
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

interface UsePlayerHotkeysOptions {
  isOpen: boolean
  floatingWindow: Window | null
  mediaSuspended: boolean
  isFullscreen: boolean
  mediaType: 'video' | 'audio' | 'unknown'
  mediaRef: MutableRefObject<HTMLVideoElement | HTMLAudioElement | null>
  lastNonZeroVolumeRef: MutableRefObject<number>
  setVolume: Dispatch<SetStateAction<number>>
  setIsMuted: Dispatch<SetStateAction<boolean>>
  handleClose: () => void
  togglePlay: () => void
  toggleMute: () => void
  toggleFullscreen: () => void
}

export function usePlayerHotkeys({
  isOpen,
  floatingWindow,
  mediaSuspended,
  isFullscreen,
  mediaType,
  mediaRef,
  lastNonZeroVolumeRef,
  setVolume,
  setIsMuted,
  handleClose,
  togglePlay,
  toggleMute,
  toggleFullscreen,
}: UsePlayerHotkeysOptions): void {
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (floatingWindow && e.currentTarget === window) return
      if (mediaSuspended && e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      if (
        target?.closest('input, select, textarea, button, [role="menu"], [contenteditable="true"]')
      ) {
        return
      }
      switch (e.key) {
        case 'Escape':
          isFullscreen ? document.exitFullscreen?.() : handleClose()
          break
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          if (mediaRef.current) mediaRef.current.currentTime -= 5
          break
        case 'ArrowRight':
          if (mediaRef.current) mediaRef.current.currentTime += 5
          break
        case 'ArrowUp':
          setVolume(v => {
            const next = Math.min(1, Number((v + 0.1).toFixed(2)))
            if (next > 0) {
              lastNonZeroVolumeRef.current = next
              setIsMuted(false)
            }
            return next
          })
          break
        case 'ArrowDown':
          setVolume(v => {
            const next = Math.max(0, Number((v - 0.1).toFixed(2)))
            if (next > 0) lastNonZeroVolumeRef.current = next
            if (next === 0) setIsMuted(true)
            return next
          })
          break
        case 'm':
          toggleMute()
          break
        case 'f':
          if (mediaType === 'video' && !floatingWindow) toggleFullscreen()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    floatingWindow?.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      floatingWindow?.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    floatingWindow,
    handleClose,
    isFullscreen,
    isOpen,
    lastNonZeroVolumeRef,
    mediaRef,
    mediaSuspended,
    mediaType,
    setIsMuted,
    setVolume,
    toggleFullscreen,
    toggleMute,
    togglePlay,
  ])
}
