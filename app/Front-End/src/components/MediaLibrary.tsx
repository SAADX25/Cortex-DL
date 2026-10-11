import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Film, FolderOpen, ImagePlus, Library, Loader2, Music2, Play, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react'
import { useLang } from '../stores/useSettingsStore'
import { useUIStore } from '../stores/useUIStore'
import { useMediaLibraryStore } from '../stores/useMediaLibraryStore'
import { canEmbedLibraryArtwork, canEditLibraryArtwork, type LibraryMediaItem } from '../../../Shared/mediaLibrary'
import './MediaLibrary.css'
import LibraryThumbnail from './LibraryThumbnail'
import ArtworkProgress from './ArtworkProgress'

const labels = {
  en: {
    title: 'Media Library', intro: 'Your videos and music. Ready to play.', add: 'Add media',
    dropTitle: 'Make room for your favorites', dropText: 'Drop videos and audio here, or choose files from your computer.',
    local: 'Files stay in their original location.', formats: 'MP4, MKV, WEBM · MP3, FLAC, WAV and more',
    all: 'All media', video: 'Videos', audio: 'Audio', search: 'Search your library…', searchLabel: 'Search media library',
    sort: 'Sort library', newest: 'Recently added', name: 'Name A–Z', played: 'Recently played',
    play: 'Play', folder: 'Show in folder', remove: 'Remove from library', locate: 'Locate file',
    addCover: 'Add cover', changeCover: 'Change cover', removeCover: 'Remove cover from file and library', coverHint: 'JPG, PNG or WEBP · up to 8 MB · embedded in the media file', libraryCoverHint: 'JPG, PNG or WEBP · up to 8 MB · stored in the library for this format', coverError: 'Choose a valid JPG, PNG or WEBP image up to 8 MB.',
    embedCover: 'Save to file', coverSaved: 'Cover saved to file', coverWriteError: 'Could not save the cover to this file. Close it in other players and check that the file and folder are writable.', coverChangedError: 'The file changed during saving. Refresh the library and try again.', coverRecoveryError: 'Could not restore the original file. Its backup is saved here:',
    coverPlayingError: 'Close this file’s player before changing its cover.', removeLibraryCover: 'Remove library cover',
    missing: 'File moved or missing', unreadable: 'File cannot be read', refresh: 'Refresh library',
    nothing: 'No matches found', nothingText: 'Try a different name or show all media.', reset: 'Reset filters',
    removeTitle: 'Remove this item?', removeText: 'This removes the item from your library. The file stays on your computer.', cancel: 'Cancel',
    added: 'added', duplicates: 'already in your library', rejected: 'could not be added', dismiss: 'Dismiss message', retry: 'Try again',
    error: 'Could not update your library. Please try again.', loadError: 'Could not read the saved library. Your media files are safe.',
    missingError: 'This file is no longer available. Refresh the library, then locate the file.', duplicateError: 'That file is already in your library.',
    fullError: 'Your library has reached its limit of 10,000 files.', tooMany: 'Add up to 500 files at a time.',
    dropActive: 'Drop to add video & audio', count: 'items', loading: 'Loading your library…',
    previous: 'Previous', next: 'Next', pages: 'Media library pages', perPage: 'Items per page', page: 'Page', of: 'of',
  },
  ar: {
    title: 'مكتبة الوسائط', intro: 'فيديوهاتك وموسيقاك، جاهزة للتشغيل.', add: 'إضافة وسائط',
    dropTitle: 'مكان لمقاطعك المفضلة', dropText: 'اسحب الفيديوهات والملفات الصوتية هنا، أو اختر ملفات من جهازك.',
    local: 'تبقى الملفات في موقعها الأصلي.', formats: 'MP4, MKV, WEBM · MP3, FLAC, WAV والمزيد',
    all: 'كل الوسائط', video: 'فيديو', audio: 'صوت', search: 'ابحث في مكتبتك…', searchLabel: 'البحث في مكتبة الوسائط',
    sort: 'ترتيب المكتبة', newest: 'المضافة حديثًا', name: 'الاسم', played: 'المشغّلة حديثًا',
    play: 'تشغيل', folder: 'عرض في المجلد', remove: 'إزالة من المكتبة', locate: 'تحديد موقع الملف',
    addCover: 'إضافة صورة', changeCover: 'تغيير الصورة', removeCover: 'إزالة الغلاف من الملف والمكتبة', coverHint: 'JPG أو PNG أو WEBP · حتى 8 ميغابايت · تُدمج داخل الملف', libraryCoverHint: 'JPG أو PNG أو WEBP · حتى 8 ميغابايت · تُحفظ في المكتبة لهذه الصيغة', coverError: 'اختر صورة صالحة بصيغة JPG أو PNG أو WEBP بحجم لا يتجاوز 8 ميغابايت.',
    embedCover: 'حفظ داخل الملف', coverSaved: 'الغلاف محفوظ داخل الملف', coverWriteError: 'تعذّر حفظ الغلاف داخل الملف. أغلقه في المشغلات الأخرى وتأكد أن الملف والمجلد يسمحان بالكتابة.', coverChangedError: 'تغيّر الملف أثناء الحفظ. حدّث المكتبة وحاول مجددًا.', coverRecoveryError: 'تعذّر استعادة الملف الأصلي. النسخة الاحتياطية محفوظة هنا:',
    coverPlayingError: 'أغلق مشغل هذا الملف قبل تغيير غلافه.', removeLibraryCover: 'إزالة الصورة من المكتبة',
    missing: 'الملف منقول أو غير موجود', unreadable: 'تعذرت قراءة الملف', refresh: 'تحديث المكتبة',
    nothing: 'لا توجد نتائج', nothingText: 'جرّب اسمًا آخر أو اعرض كل الوسائط.', reset: 'إعادة ضبط الفلاتر',
    removeTitle: 'إزالة هذا العنصر؟', removeText: 'ستتم إزالة العنصر من المكتبة. يبقى الملف محفوظًا على جهازك.', cancel: 'إلغاء',
    added: 'تمت إضافتها', duplicates: 'موجودة في المكتبة', rejected: 'تعذرت إضافتها', dismiss: 'إغلاق الرسالة', retry: 'إعادة المحاولة',
    error: 'تعذر تحديث المكتبة. حاول مجددًا.', loadError: 'تعذرت قراءة المكتبة المحفوظة. ملفات الوسائط محفوظة على جهازك.',
    missingError: 'هذا الملف غير متاح. حدّث المكتبة ثم حدد موقع الملف.', duplicateError: 'هذا الملف موجود في المكتبة بالفعل.',
    fullError: 'وصلت مكتبتك إلى الحد الأقصى: 10,000 ملف.', tooMany: 'يمكن إضافة 500 ملف في المرة الواحدة.',
    dropActive: 'أفلت لإضافة الفيديو والصوت', count: 'عنصر', loading: 'جارٍ تحميل المكتبة…',
    previous: 'السابق', next: 'التالي', pages: 'صفحات مكتبة الوسائط', perPage: 'عدد الملفات في الصفحة', page: 'صفحة', of: 'من',
  },
}
function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3)
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][index]}`
}

export default function MediaLibrary() {
  const lang = useLang(), t = labels[lang]
  const activeTab = useUIStore(state => state.activeTab)
  const playerOpen = useUIStore(state => !!state.mediaPlayerFile && !state.mediaPlayerFloating)
  const items = useMediaLibraryStore(state => state.items), busy = useMediaLibraryStore(state => state.busy)
  const loaded = useMediaLibraryStore(state => state.loaded), loading = useMediaLibraryStore(state => state.loading)
  const error = useMediaLibraryStore(state => state.error), imported = useMediaLibraryStore(state => state.imported)
  const refresh = useMediaLibraryStore(state => state.refresh), importFiles = useMediaLibraryStore(state => state.importFiles)
  const play = useMediaLibraryStore(state => state.play), remove = useMediaLibraryStore(state => state.remove)
  const relocate = useMediaLibraryStore(state => state.relocate), dismissNotice = useMediaLibraryStore(state => state.dismissNotice)
  const selectArtwork = useMediaLibraryStore(state => state.selectArtwork), removeArtwork = useMediaLibraryStore(state => state.removeArtwork)
  const embedArtwork = useMediaLibraryStore(state => state.embedArtwork)
  const artworkInfo = useMediaLibraryStore(state => state.artworkInfo)
  const hasCover = (item: LibraryMediaItem) => !!item.artwork || canEmbedLibraryArtwork(item.filePath) && !!artworkInfo[item.id]
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<'all' | 'video' | 'audio'>('all')
  const [sort, setSort] = useState<'newest' | 'name' | 'played'>('newest'), [dragging, setDragging] = useState(false)
  const [dropError, setDropError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    try { const saved = Number(localStorage.getItem('cortexdl_library_page_size')); return [2, 4, 8, 12].includes(saved) ? saved : 2 }
    catch { return 2 }
  })
  const depth = useRef(0), search = useRef<HTMLInputElement>(null), toolbar = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null)
  useEffect(() => { try { localStorage.setItem('cortexdl_library_page_size', String(pageSize)) } catch { /* Keep this session's choice. */ } }, [pageSize])

  useEffect(() => {
    if (activeTab !== 'library') return
    void refresh()
    const focus = () => { if (!document.hidden) void refresh() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus) }
  }, [activeTab, refresh])
  useEffect(() => {
    depth.current = 0; setDragging(false)
    if (activeTab !== 'library' || playerOpen) return
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ['f', 'k'].includes(event.key.toLowerCase())) {
        event.preventDefault(); search.current?.focus()
      } else if (event.key === 'Escape' && document.activeElement === search.current) { setQuery(''); setPage(1); search.current?.blur() }
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [activeTab, playerOpen])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(lang)
    return items.filter(item => (filter === 'all' || item.kind === filter)
      && (!needle || `${item.name} ${item.filePath}`.toLocaleLowerCase(lang).includes(needle)))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, lang, { numeric: true })
        : sort === 'played' ? (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.addedAt - a.addedAt : b.addedAt - a.addedAt)
  }, [items, query, filter, sort, lang])
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize)), currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * pageSize, pageItems = visible.slice(start, start + pageSize)
  useEffect(() => { setPage(previous => Math.min(previous, pageCount)) }, [pageCount])
  const changePage = (next: number) => {
    setPage(Math.max(1, Math.min(next, pageCount)))
    const controls = toolbar.current, content = controls?.closest('.main-content')
    if (controls && content && list.current) content.scrollTo({
      top: content.scrollTop + list.current.getBoundingClientRect().top - content.getBoundingClientRect().top - controls.offsetHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }
  const pagination = <nav className="library-pagination top" aria-label={t.pages}>
    <label className="library-page-size">{t.perPage}<select value={pageSize} disabled={busy} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>{[2, 4, 8, 12].map(count => <option value={count} key={count}>{count}</option>)}</select></label>
    <span className="library-page-range"><b dir="ltr">{start + 1}–{Math.min(start + pageSize, visible.length)}</b> {t.of} {visible.length}</span>
    <div className="library-page-buttons">
      <button className="library-page-previous" disabled={busy || currentPage === 1} onClick={() => changePage(currentPage - 1)}>{lang === 'ar' ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}{t.previous}</button>
      <span className="library-page-number" aria-live="polite">{t.page} <b>{currentPage}</b> {t.of} {pageCount}</span>
      <button className="library-page-next" disabled={busy || currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>{t.next}{lang === 'ar' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button>
    </div>
  </nav>
  const counts = { all: items.length, video: items.filter(item => item.kind === 'video').length, audio: items.filter(item => item.kind === 'audio').length }
  const reset = () => { setQuery(''); setFilter('all'); setPage(1) }
  const requestRemove = (item: LibraryMediaItem) => {
    useUIStore.getState().setModalConfig({
      isOpen: true, title: t.removeTitle, message: `${item.name}\n${t.removeText}`, confirmText: t.remove, cancelText: t.cancel, type: 'warning',
      onConfirm: () => { useUIStore.getState().closeModal(); void remove(item.id) }, onCancel: () => useUIStore.getState().closeModal(),
    })
  }
  const drop = (event: React.DragEvent) => {
    event.preventDefault(); depth.current = 0; setDragging(false); setDropError('')
    if (busy) return
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    if (files.length > 500) { setDropError(t.tooMany); return }
    try {
      const paths = window.cortexDl.getDroppedMediaPaths(files)
      if (!paths.length) { setDropError(t.error); return }
      void importFiles(paths)
    } catch { setDropError(t.error) }
  }
  const errorText = error?.includes('MEDIA_LIBRARY_ARTWORK_RECOVERY:') ? `${t.coverRecoveryError} ${error.split('MEDIA_LIBRARY_ARTWORK_RECOVERY:')[1]?.trim()}` : error?.includes('MEDIA_LIBRARY_ARTWORK_FILE_CHANGED') ? t.coverChangedError
    : error?.includes('MEDIA_LIBRARY_ARTWORK_PLAYING') ? t.coverPlayingError : error?.includes('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED') ? t.coverWriteError : error?.includes('MEDIA_LIBRARY_ARTWORK_INVALID') ? t.coverError : error?.includes('MEDIA_LIBRARY_READ_FAILED') || error?.includes('MEDIA_LIBRARY_INVALID') ? t.loadError
    : error?.includes('MEDIA_LIBRARY_MISSING') || error?.includes('MEDIA_LIBRARY_UNREADABLE') ? t.missingError
    : error?.includes('MEDIA_LIBRARY_DUPLICATE') ? t.duplicateError : error?.includes('MEDIA_LIBRARY_FULL') ? t.fullError : t.error
  const notices = imported ? [[imported.added, t.added], [imported.duplicates, t.duplicates], [imported.rejected.length, t.rejected]].filter(([count]) => count).map(([count, label]) => `${count} ${label}`).join(' · ') : ''

  return <section className={`tab-content media-library ${dragging ? 'is-dragging' : ''}`} dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-labelledby="library-title"
    onDragEnter={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); depth.current++; setDragging(true) }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy' } }}
    onDragLeave={event => { event.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false) }} onDrop={drop}>
    <header className="library-header">
      <div><div className="library-heading"><h2 id="library-title">{t.title}</h2><span className="library-count">{items.length}</span></div><p>{t.intro}</p></div>
      <button className="library-add" disabled={busy || (!loaded && (loading || !!error))} onClick={() => { setDropError(''); void importFiles() }}><Plus size={18} />{busy ? <Loader2 size={16} className="spin" /> : t.add}</button>
    </header>

    {(error || dropError) && <div className="library-notice is-error" role="alert"><AlertCircle size={18} /><span>{dropError || errorText}</span><button disabled={busy} onClick={() => { setDropError(''); void refresh() }}>{t.retry}</button><button className="library-icon-button" aria-label={t.dismiss} onClick={() => { setDropError(''); dismissNotice() }}><X size={16} /></button></div>}
    {notices && <div className={`library-notice ${imported?.rejected.length ? 'is-warning' : ''}`} role="status"><CheckCircle2 size={18} /><span>{notices}</span><button className="library-icon-button" aria-label={t.dismiss} onClick={dismissNotice}><X size={16} /></button></div>}

    {!loaded && loading ? <div className="library-loading" role="status"><Loader2 className="spin" size={24} />{t.loading}</div> : <>
      {!items.length && <div className="library-drop">
        <div className="library-drop-art" aria-hidden="true"><Film size={32} /><Music2 size={27} /></div>
        <div className="library-drop-copy"><h3>{t.dropTitle}</h3><p>{t.dropText}</p><small>{t.local}</small></div>
        <button className="library-add" disabled={busy || (!loaded && (loading || !!error))} onClick={() => void importFiles()}><FolderOpen size={18} />{t.add}</button><span className="library-formats" dir="auto">{t.formats}</span>
      </div>}
      {!!items.length && <>
        <div className="library-controls" ref={toolbar}>
        <div className="library-toolbar">
          <div className="library-search"><Search size={18} /><input ref={search} type="search" value={query} placeholder={t.search} aria-label={t.searchLabel} onChange={event => { setQuery(event.target.value); setPage(1) }} />{query && <button className="library-icon-button" onClick={() => { setQuery(''); setPage(1) }} aria-label={t.reset}><X size={15} /></button>}</div>
          <select value={sort} aria-label={t.sort} onChange={event => { setSort(event.target.value as typeof sort); setPage(1) }}><option value="newest">{t.newest}</option><option value="name">{t.name}</option><option value="played">{t.played}</option></select>
          <button className="library-icon-button library-refresh" disabled={loading || busy} onClick={() => void refresh()} title={t.refresh} aria-label={t.refresh}><RefreshCw size={17} className={loading ? 'spin' : ''} /></button>
        </div>
        <div className="library-filters" role="group" aria-label={t.title}>{(['all', 'video', 'audio'] as const).map(kind => <button key={kind} aria-pressed={filter === kind} className={filter === kind ? 'active' : ''} onClick={() => { setFilter(kind); setPage(1) }}>{kind === 'all' ? <Library size={15} /> : kind === 'video' ? <Film size={15} /> : <Music2 size={15} />}{t[kind]}<span>{counts[kind]}</span></button>)}<span className="library-results" role="status">{visible.length} {t.count}</span></div>
        {visible.length > 0 && pagination}
        </div>
        {visible.length ? <div className="library-list" ref={list}>{pageItems.map(item => <article key={item.id} className={`library-card ${item.kind} ${item.availability !== 'available' ? 'is-unavailable' : ''}`}>
          <LibraryThumbnail item={item} active={activeTab === 'library'} />
          <div className="library-card-body">
          <div className="library-card-details">
          <div className="library-card-header"><h3 title={item.name} dir="auto">{item.name.replace(/\.[^.]+$/, '')}</h3><span className="library-format">{item.name.split('.').pop()?.toUpperCase()}</span></div>
          <p className="library-file-path" title={item.filePath} dir="auto">{item.filePath}</p>
          <div className="library-card-meta"><span>{item.kind === 'video' ? t.video : t.audio}</span><span aria-hidden="true">·</span><span dir="ltr">{formatSize(item.size)}</span></div>
          {(item.artworkEmbedded || !item.artwork && canEmbedLibraryArtwork(item.filePath) && artworkInfo[item.id]) && <div className="library-cover-saved"><CheckCircle2 size={13} />{t.coverSaved}</div>}
          {item.availability !== 'available' && <div className="library-unavailable"><AlertCircle size={14} />{item.availability === 'missing' ? t.missing : t.unreadable}</div>}
          <ArtworkProgress itemId={item.id} />
          </div>
          <div className="library-card-actions"><button className="library-play" disabled={busy} onClick={() => item.availability === 'available' ? void play(item.id) : void relocate(item.id)} aria-label={`${item.availability === 'available' ? t.play : t.locate}: ${item.name}`}>{item.availability === 'available' ? <Play size={16} /> : <FolderOpen size={16} />}{item.availability === 'available' ? t.play : t.locate}</button>
            <button className="library-icon-button" disabled={busy || item.availability !== 'available'} title={t.folder} aria-label={`${t.folder}: ${item.name}`} onClick={() => void window.cortexDl.openFolder(item.filePath).catch(() => setDropError(t.error))}><FolderOpen size={17} /></button>
            {canEditLibraryArtwork(item) && <div className="library-cover-actions">
              <button className="library-cover-button" disabled={busy} onClick={() => void selectArtwork(item.id)} title={canEmbedLibraryArtwork(item.filePath) ? t.coverHint : t.libraryCoverHint} aria-label={`${hasCover(item) ? t.changeCover : t.addCover}: ${item.name}`}><ImagePlus size={16} />{hasCover(item) ? t.changeCover : t.addCover}</button>
              {item.artwork && !item.artworkEmbedded && canEmbedLibraryArtwork(item.filePath) && <button className="library-cover-button library-cover-embed" disabled={busy || item.availability !== 'available'} onClick={() => void embedArtwork(item.id)}><CheckCircle2 size={15} />{t.embedCover}</button>}
              {hasCover(item) && <button className="library-icon-button library-cover-remove" disabled={busy} onClick={() => void removeArtwork(item.id)} title={canEmbedLibraryArtwork(item.filePath) ? t.removeCover : t.removeLibraryCover} aria-label={`${canEmbedLibraryArtwork(item.filePath) ? t.removeCover : t.removeLibraryCover}: ${item.name}`}><X size={15} /></button>}
            </div>}
            <button className="library-icon-button library-remove" disabled={busy} title={t.remove} aria-label={`${t.remove}: ${item.name}`} onClick={() => requestRemove(item)}><Trash2 size={16} /></button>
          </div>
          </div>
        </article>)}</div> : <div className="library-no-results"><Search size={30} /><h3>{t.nothing}</h3><p>{t.nothingText}</p><button onClick={reset}>{t.reset}</button></div>}
      </>}
    </>}
    {dragging && <div className="library-drag-overlay" aria-hidden="true"><Upload size={42} /><strong>{t.dropActive}</strong></div>}
  </section>
}
