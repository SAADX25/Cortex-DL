import { useEffect, useRef, useState } from 'react'
import { Film, Music2 } from 'lucide-react'
import type { LibraryMediaItem } from '../../../Shared/mediaLibrary'
import { useMediaLibraryStore } from '../stores/useMediaLibraryStore'

export default function LibraryThumbnail({ item, active }: { item: LibraryMediaItem; active: boolean }) {
  const { id, filePath, availability, size, artwork, artworkEmbedded } = item
  const refreshVersion = useMediaLibraryStore(state => state.refreshVersion)
  const root = useRef<HTMLDivElement>(null)
  const [image, setImage] = useState<{ path: string; url: string; embedded: boolean } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (!active || availability !== 'available' || !root.current) return
    let disposed = false, visible = false, inFlight = false, completed = false
    const load = async (retry = false) => {
      if (disposed || !visible || inFlight || completed && !retry) return
      inFlight = true
      try {
        const info = await window.cortexDl.getMediaLibraryArtworkInfo(id)
        if (!disposed) {
          completed = true
          setImage(info.thumbnail ? { path: filePath, url: info.thumbnail, embedded: info.embedded } : null); setFailed(null)
          useMediaLibraryStore.getState().setArtworkInfo(id, info.embedded)
        }
      } catch { /* Artwork is optional; retain the media icon. */ }
      finally { inFlight = false }
    }
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting)
      if (visible) void load()
    }, { rootMargin: '150px' })
    observer.observe(root.current)
    const unsubscribe = window.cortexDl.onSetupProgress?.(state => { if (state.status === 'ready') void load(true) })
    return () => { disposed = true; observer.disconnect(); unsubscribe?.() }
  }, [id, filePath, availability, size, artwork, artworkEmbedded, active, refreshVersion])
  const url = item.availability === 'available' && image?.path === item.filePath && image.url !== failed ? image.url : null
  return <div ref={root} className={`library-thumbnail ${url ? 'has-image' : ''} ${item.artwork || image?.embedded ? 'has-cover' : ''}`} aria-hidden="true">
    {url ? <img src={url} alt="" decoding="async" onError={() => setFailed(url)} /> : <div className="library-media-icon">{item.kind === 'video' ? <Film size={29} strokeWidth={1.5} /> : <Music2 size={29} strokeWidth={1.5} />}</div>}
  </div>
}
