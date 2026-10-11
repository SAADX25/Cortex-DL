import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import MediaPlayerModal from '../../Front-End/src/components/MediaPlayer/MediaPlayerModal'
import { useUIStore } from '../../Front-End/src/stores/useUIStore'
import { useSettingsStore } from '../../Front-End/src/stores/useSettingsStore'

let closed = [], downloads = 0, originalVideo = null
let coverMode = 'save', edits = []
let entries = ['video.mp4', 'audio.mp3'].map(filePath => ({ id: filePath, filePath, name: filePath, kind: filePath.endsWith('mp4') ? 'video' : 'audio', size: 1000, addedAt: 1, lastPlayedAt: null, availability: 'available' }))
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#8866cc"/></svg>')
const edit = async (id, remove) => {
  const media = document.querySelector('video, audio') ?? originalVideo
  if (media?.getAttribute('src')) throw Error('Player must unload before editing its file')
  if (!closed.length) throw Error('Player must close the server session before editing')
  edits.push({ id, remove })
  await new Promise(resolve => setTimeout(resolve, 80))
  if (coverMode === 'cancel') return null
  if (coverMode === 'fail') throw Error('MEDIA_LIBRARY_ARTWORK_WRITE_FAILED')
  entries = entries.map(item => item.id !== id ? item : { ...item, artwork: remove ? undefined : 'a'.repeat(64), artworkEmbedded: remove ? undefined : true })
  return entries.map(item => ({ ...item }))
}
window.cortexDl = {
  listMediaLibrary: async () => entries.map(item => ({ ...item })),
  getMediaLibraryArtworkInfo: async id => ({ thumbnail: entries.find(item => item.id === id)?.artwork ? art : null, embedded: !!entries.find(item => item.id === id)?.artworkEmbedded }),
  selectMediaLibraryArtwork: id => edit(id, false),
  removeMediaLibraryArtwork: id => edit(id, true),
  getBuildInfo: async () => ({ safeMode: useUIStore.getState().mediaPlayerFile?.filePath !== 'audio.mp3' }),
  getMediaEndpoint: async () => ({ port: __MEDIA_PORT__, token: 'fixture' }),
  getSubtitles: async () => [{ language: 'ar', label: 'Arabic', filePath: 'ar.vtt' }, { language: 'en', label: 'English', filePath: 'en.vtt' }],
  closeMediaSession: async id => { closed.push(id) },
  getMediaDiagnostics: async () => ({ streams: 0, ffmpegProcesses: 0, probeProcesses: 0, sessions: 0 }),
}
useSettingsStore.setState({ lang: 'ar' })
useUIStore.getState().setMediaPlayerFile({ filePath: 'video.mp4' })
window.fixture = {
  remember: () => { originalVideo = document.querySelector('video') },
  video: () => originalVideo,
  result: () => ({ closed, downloads, floating: useUIStore.getState().mediaPlayerFloating }),
  stop: () => useUIStore.getState().setMediaPlayerFile(null),
  reopen: () => useUIStore.getState().setMediaPlayerFile({ filePath: 'video.mp4' }),
  openAudio: () => useUIStore.getState().setMediaPlayerFile({ filePath: 'audio.mp3' }),
  coverMode: mode => { coverMode = mode },
  coverEdits: () => edits,
}
function Fixture() {
  const file = useUIStore(state => state.mediaPlayerFile), [, update] = useState(0)
  return <>
    <h1>تنزيل مقطع جديد</h1><input id="download-url" placeholder="رابط الفيديو" />
    <button id="new-download" onClick={() => { downloads++; update(downloads) }}>تنزيل</button>
    <p>عدد التنزيلات: {downloads}</p>
    {file && <MediaPlayerModal key={file.filePath} isOpen filePath={file.filePath} title="موسيقى هادئة للاختبار — عنوان أغنية طويل" dir="rtl" onClose={window.fixture.stop} />}
  </>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>)
