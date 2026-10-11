import { useEffect, useId, useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { canEmbedLibraryArtwork, libraryMediaKind } from '../../../../Shared/mediaLibrary'
import { useMediaLibraryStore } from '../../stores/useMediaLibraryStore'
import { useLang } from '../../stores/useSettingsStore'
import ArtworkProgress from '../ArtworkProgress'

const key = (path: string) => path.replace(/\\/g, '/').toLowerCase()

export function PlayerArtworkMenu({ filePath, suspend, onOpenChange, onImage }: {
  filePath: string
  suspend: () => Promise<() => void>
  onOpenChange: (open: boolean) => void
  onImage: (url: string | null) => void
}) {
  const ar = useLang() === 'ar', id = useId()
  const t = ar
    ? { title: 'غلاف الملف', add: 'إضافة صورة', change: 'تغيير الصورة', remove: 'إزالة الغلاف', saved: 'الغلاف محفوظ داخل الملف', hint: 'JPG أو PNG أو WEBP · حتى 8 ميغابايت', local: 'تُحفظ الصورة في المكتبة لهذه الصيغة.', invalid: 'اختر صورة صالحة بصيغة JPG أو PNG أو WEBP بحجم لا يتجاوز 8 ميغابايت.', error: 'تعذّر تعديل الغلاف. أغلق الملف في المشغلات الأخرى وتأكد من صلاحية الكتابة.', changed: 'تغيّر الملف أثناء الحفظ. حدّث المكتبة وحاول مجددًا.', recovery: 'النسخة الاحتياطية للملف محفوظة هنا:' }
    : { title: 'File cover', add: 'Add cover', change: 'Change cover', remove: 'Remove cover', saved: 'Cover saved to file', hint: 'JPG, PNG or WEBP · up to 8 MB', local: 'Cover stored in the library for this format.', invalid: 'Choose a valid JPG, PNG or WEBP image up to 8 MB.', error: 'Could not edit the cover. Close the file in other players and check write permissions.', changed: 'The file changed during saving. Refresh the library and try again.', recovery: 'The file backup is saved here:' }
  const item = useMediaLibraryStore(state => state.items.find(entry => key(entry.filePath) === key(filePath)))
  const busy = useMediaLibraryStore(state => state.busy), error = useMediaLibraryStore(state => state.error)
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false)
  const [image, setImage] = useState<string | null>(null), [embedded, setEmbedded] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const supported = libraryMediaKind(filePath) === 'audio' || canEmbedLibraryArtwork(filePath)
  const hasCover = !!item?.artwork || embedded

  useEffect(() => { onOpenChange(open); return () => onOpenChange(false) }, [open, onOpenChange])
  useEffect(() => {
    if (!supported || !window.cortexDl.listMediaLibrary) return
    void useMediaLibraryStore.getState().refresh()
  }, [supported])
  useEffect(() => {
    let disposed = false
    setImage(null); setEmbedded(false); setLoading(false); onImage(null)
    if (!item || !window.cortexDl.getMediaLibraryArtworkInfo) return
    setLoading(true)
    window.cortexDl.getMediaLibraryArtworkInfo(item.id).then(info => {
      if (disposed) return
      setImage(info.thumbnail); setEmbedded(info.embedded); onImage(info.thumbnail)
      useMediaLibraryStore.getState().setArtworkInfo(item.id, info.embedded)
    }).catch(() => {}).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [item, onImage])
  useEffect(() => {
    if (!open) return
    const document = wrapper.current?.ownerDocument
    if (!document) return
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node) && !busy) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation()
      if (!busy) { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true) }
  }, [open, busy])
  if (!supported || !window.cortexDl.listMediaLibrary) return null

  const toggle = async () => {
    if (busy) return
    useMediaLibraryStore.getState().dismissNotice()
    if (open) { setOpen(false); return }
    setOpen(true)
    if (!item) await useMediaLibraryStore.getState().importFiles([filePath])
  }
  const recovery = error?.includes('MEDIA_LIBRARY_ARTWORK_RECOVERY:')
  const message = recovery ? `${t.recovery} ${error?.split('MEDIA_LIBRARY_ARTWORK_RECOVERY:')[1]}`
    : error?.includes('MEDIA_LIBRARY_ARTWORK_FILE_CHANGED') ? t.changed : error?.includes('MEDIA_LIBRARY_ARTWORK_INVALID') ? t.invalid : t.error
  return <div className="player-artwork-wrapper" ref={wrapper} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <button ref={trigger} type="button" className={`control-btn player-artwork-trigger ${open ? 'active' : ''}`} aria-label={t.title} title={t.title} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined} onClick={() => { void toggle() }}>
      <ImagePlus size={20} />
    </button>
    {open && <div id={id} className="player-artwork-menu" role="dialog" aria-label={t.title} dir={ar ? 'rtl' : 'ltr'}>
      <strong>{t.title}</strong>
      {image && <img src={image} alt={t.title} />}
      <small>{t.hint}</small>
      {canEmbedLibraryArtwork(filePath) ? hasCover && (embedded || item?.artworkEmbedded) && <small className="player-artwork-saved">{t.saved}</small> : <small>{t.local}</small>}
      <button type="button" className="player-artwork-change" disabled={!item || busy || loading} onClick={() => { if (item) void useMediaLibraryStore.getState().selectArtwork(item.id, suspend) }}>
        {busy || loading ? <Loader2 size={16} className="spin" /> : <ImagePlus size={16} />}{hasCover ? t.change : t.add}
      </button>
      {hasCover && <button type="button" className="player-artwork-remove" disabled={!item || busy || loading} onClick={() => { if (item) void useMediaLibraryStore.getState().removeArtwork(item.id, suspend) }}><Trash2 size={16} />{t.remove}</button>}
      {item && <ArtworkProgress itemId={item.id} />}
      {error && <p role="alert">{message}</p>}
    </div>}
  </div>
}
