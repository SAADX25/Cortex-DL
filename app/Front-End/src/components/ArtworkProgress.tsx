import { useMediaLibraryStore } from '../stores/useMediaLibraryStore'
import { useLang } from '../stores/useSettingsStore'
import './ArtworkProgress.css'

/** Indeterminate: file rewriting exposes completion, not a byte percentage. */
export default function ArtworkProgress({ itemId }: { itemId?: string }) {
  const task = useMediaLibraryStore(state => state.artworkTask), ar = useLang() === 'ar'
  if (!task || itemId && task.id !== itemId) return null
  const label = task.action === 'remove' ? ar ? 'جارٍ إزالة الغلاف…' : 'Removing cover…'
    : task.action === 'embed' ? ar ? 'جارٍ حفظ الغلاف داخل الملف…' : 'Saving cover to file…'
    : ar ? 'جارٍ تحديث الغلاف…' : 'Updating cover…'
  return <div className="artwork-progress" role="status">
    <span>{label}</span>
    <div className="artwork-progress-track" role="progressbar" aria-label={label} aria-valuetext={ar ? 'قيد المعالجة' : 'Processing'}><span /></div>
  </div>
}
