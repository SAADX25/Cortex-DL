// Inline progress indicator shown while embedding or removing media cover art
import { useMediaLibraryStore } from '../stores/useMediaLibraryStore'
import { useLang } from '../stores/useSettingsStore'
import { translations } from '../translations'
import './ArtworkProgress.css'

export default function ArtworkProgress({ itemId }: { itemId?: string }) {
  const task = useMediaLibraryStore(state => state.artworkTask)
  const art = translations[useLang()].artwork
  if (!task || (itemId && task.id !== itemId)) return null
  const label =
    task.action === 'remove' ? art.removing : task.action === 'embed' ? art.embedding : art.updating
  return (
    <div className="artwork-progress" role="status">
      <span>{label}</span>
      <div
        className="artwork-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuetext={art.processing}
      >
        <span />
      </div>
    </div>
  )
}
