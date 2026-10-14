import React from 'react'
import { createRoot } from 'react-dom/client'
import MediaLibrary from '../../Front-End/src/components/MediaLibrary'
import Sidebar from '../../Front-End/src/components/Sidebar'
import ConfirmModal from '../../Front-End/src/components/ConfirmModal'
import { useUIStore } from '../../Front-End/src/stores/useUIStore'
import { useSettingsStore } from '../../Front-End/src/stores/useSettingsStore'
import { useMediaLibraryStore } from '../../Front-End/src/stores/useMediaLibraryStore'
import '../../Front-End/src/App.css'

useSettingsStore.setState({ lang: 'en' })
localStorage.setItem('cortexdl_library_page_size', '4')
useUIStore.setState({ activeTab: 'downloads' })
let entries = [], canceled = false, failed = false, artworkFailed = false, covers = [], embedded = [], played = [], removed = [], dropped = [], folders = [], pendingRefresh
const nativeCovers = { audio: true, video: false }
let pendingArtwork
let pendingThumbnails, pendingImport
let checks = [], thumbnails = [], pendingCheck
const awaitArtwork = async () => { if (pendingArtwork) await new Promise(resolve => { pendingArtwork.resolve = resolve }) }
const samples = [
  { id: 'video', filePath: 'C:/Videos/رحلة إلى عمّان.mp4', name: 'رحلة إلى عمّان.mp4', kind: 'video', size: 482344960, addedAt: 1, lastPlayedAt: null, availability: 'available' },
  { id: 'audio', filePath: 'C:/Music/Evening piano.flac', name: 'Evening piano.flac', kind: 'audio', size: 28311552, addedAt: 2, lastPlayedAt: null, availability: 'available' },
  { id: 'missing', filePath: 'D:/Archive/Old recording.wav', name: 'Old recording.wav', kind: 'audio', size: 500000, addedAt: 3, lastPlayedAt: null, availability: 'missing' },
]
window.cortexDl = {
  checkMediaLibraryFiles: async ids => {
    checks.push(ids)
    const result = entries.filter(item => ids.includes(item.id)).map(item => ({ ...item }))
    if (pendingCheck) await new Promise(resolve => { pendingCheck.resolve = resolve })
    return result
  },
  getMediaLibraryThumbnail: async id => entries.find(item => item.id === id)?.artwork ? __LIBRARY_VIDEO_ART__ : id === 'video' ? __LIBRARY_VIDEO_ART__ : id === 'audio' ? __LIBRARY_AUDIO_ART__ : null,
  getMediaLibraryArtworkInfo: async id => {
    thumbnails.push(id)
    if (pendingThumbnails) await pendingThumbnails.promise
    return { embedded: !!nativeCovers[id] || !!entries.find(item => item.id === id)?.artworkEmbedded,
      thumbnail: entries.find(item => item.id === id)?.artwork ? __LIBRARY_VIDEO_ART__ : nativeCovers[id] ? __LIBRARY_AUDIO_ART__ : id === 'video' ? __LIBRARY_VIDEO_ART__ : null }
  },
  selectMediaLibraryArtwork: async id => {
    await awaitArtwork()
    if (canceled) return null
    if (artworkFailed) throw Error('MEDIA_LIBRARY_ARTWORK_INVALID')
    covers.push(id); entries = entries.map(item => item.id === id ? { ...item, artwork: 'a'.repeat(64), artworkEmbedded: true } : item)
    return entries.map(item => ({ ...item }))
  },
  removeMediaLibraryArtwork: async id => {
    await awaitArtwork()
    nativeCovers[id] = false
    entries = entries.map(item => { if (item.id !== id) return item; const updated = { ...item }; delete updated.artwork; delete updated.artworkEmbedded; return updated })
    return entries.map(item => ({ ...item }))
  },
  embedMediaLibraryArtwork: async id => {
    await awaitArtwork()
    embedded.push(id); entries = entries.map(item => item.id === id ? { ...item, artworkEmbedded: true } : item)
    return entries.map(item => ({ ...item }))
  },
  listMediaLibrary: async () => {
    if (failed) throw Error('MEDIA_LIBRARY_READ_FAILED')
    if (pendingRefresh) return new Promise(resolve => { pendingRefresh.resolve = resolve })
    return entries.map(item => ({ ...item }))
  },
  selectMediaLibraryFiles: async () => {
    if (canceled) return null
    const added = entries.length ? 0 : 3
    if (added) entries = samples.map(item => ({ ...item }))
    return { items: entries, added, duplicates: added ? 0 : 3, rejected: [] }
  },
  getDroppedMediaPaths: files => files.map(file => 'C:/Dropped/' + file.name),
  addMediaLibraryFiles: async paths => {
    if (pendingImport) await pendingImport.promise
    dropped = paths
    const item = { id: 'dropped', filePath: paths[0], name: paths[0].split('/').pop(), kind: 'audio', size: 2500, addedAt: 4, lastPlayedAt: null, availability: 'available' }
    entries = [...entries, item]
    return { items: entries, added: 1, duplicates: 0, rejected: [{ filePath: paths[1], reason: 'unsupported' }] }
  },
  playMediaLibraryItem: async id => { played.push(id); return { ...entries.find(item => item.id === id), lastPlayedAt: Date.now() } },
  removeMediaLibraryItem: async id => { removed.push(id); entries = entries.filter(item => item.id !== id); return entries },
  relocateMediaLibraryItem: async id => { entries = entries.map(item => item.id === id ? { ...item, filePath: 'C:/Restored/Old recording.wav', availability: 'available' } : item); return entries },
  openFolder: async path => { folders.push(path) },
}
window.fixture = {
  holdThumbnails: () => { let resolve; const promise = new Promise(done => { resolve = done }); pendingThumbnails = { promise, resolve } },
  releaseThumbnails: () => { pendingThumbnails.resolve(); pendingThumbnails = null },
  holdImport: () => { let resolve; const promise = new Promise(done => { resolve = done }); pendingImport = { promise, resolve } },
  releaseImport: () => { pendingImport.resolve(); pendingImport = null },
  importMany: () => useMediaLibraryStore.getState().importFiles(Array.from({ length: 1200 }, (_, i) => 'C:/Dropped/import-' + i + '.mp3')),
  requests: () => ({ checks, thumbnails }),
  resetRequests: () => { checks = []; thumbnails = [] },
  holdCheck: () => { pendingCheck = {} },
  releaseCheck: () => { pendingCheck.resolve(); pendingCheck = null },
  large: () => {
    entries = Array.from({ length: 1200 }, (_, i) => ({ ...samples[1], id: 'large-' + i, name: 'Track ' + i + '.mp3', filePath: 'C:/Music/Track ' + i + '.mp3', addedAt: i + 4 }))
    return useMediaLibraryStore.getState().refresh()
  },
  result: () => ({ covers, embedded, played, removed, dropped, folders, player: useUIStore.getState().mediaPlayerFile, count: entries.length }),
  legacyCover: () => { entries = entries.map(item => { const copy = { ...item }; delete copy.artworkEmbedded; return copy }); return useMediaLibraryStore.getState().refresh() },
  nativeVideoCover: () => { nativeCovers.video = true; return useMediaLibraryStore.getState().refresh() },
  canceled: value => { canceled = value },
  language: lang => useSettingsStore.setState({ lang }),
  closePlayer: () => useUIStore.setState({ mediaPlayerFile: null }),
  openAudioPlayer: () => useUIStore.setState({ mediaPlayerFile: { filePath: samples[1].filePath, title: 'Evening piano' } }),
  failure: value => { failed = value },
  artworkFailure: value => { artworkFailed = value },
  holdArtwork: () => { pendingArtwork = {} },
  releaseArtwork: () => { pendingArtwork.resolve(); pendingArtwork = null },
  many: () => {
    entries = [...samples.map(item => ({ ...item })), ...Array.from({ length: 6 }, (_, i) => ({ ...samples[1], id: 'extra-' + i, name: 'Track ' + i + '.mp3', filePath: 'C:/Music/Track ' + i + '.mp3', addedAt: i + 4 }))]
    return useMediaLibraryStore.getState().refresh()
  },
  refresh: () => useMediaLibraryStore.getState().refresh(),
  holdRefresh: () => { pendingRefresh = {} },
  releaseRefresh: () => { pendingRefresh.resolve([]); pendingRefresh = null },
  restore: () => { entries = samples.map(item => ({ ...item })); return useMediaLibraryStore.getState().refresh() },
}
function Fixture() {
  const lang = useSettingsStore(state => state.lang), modal = useUIStore(state => state.modalConfig), active = useUIStore(state => state.activeTab)
  return <div className="app-container" dir={lang === 'ar' ? 'rtl' : 'ltr'}><Sidebar /><main className="main-content"><div style={{ width: '100%', height: '100%', display: active === 'library' ? 'flex' : 'none', flexDirection: 'column' }}><MediaLibrary /></div></main>
    <ConfirmModal {...modal} dir={lang === 'ar' ? 'rtl' : 'ltr'} onCancel={() => useUIStore.getState().closeModal()} /></div>
}
createRoot(document.getElementById('root')).render(<Fixture />)
