import React from 'react'
import { createRoot } from 'react-dom/client'
import DownloadCard from '../../Front-End/src/components/DownloadCard'
import { useDownloadStore } from '../../Front-End/src/stores/downloadStore'
import { useSettingsStore } from '../../Front-End/src/stores/useSettingsStore'
let files = [], pending, request, opened, canceled = 0
const tracks = [{ fileName: 'Nightcore_-_If_U_Seek_Amy_-_(Lyrics).ar.srt', language: 'ar', label: 'Arabic' }, { fileName: 'Nightcore_-_If_U_Seek_Amy_-_(Lyrics).en.vtt', language: 'en', label: 'English' }]
window.cortexDl = {
  listDownloadSubtitleFiles: async () => files,
  mergeDownloadSubtitle: (...args) => { request = args; return new Promise(resolve => { pending = resolve }) },
  cancelDownloadSubtitleMerge: async () => { canceled++; pending?.(null) },
}
window.fixture = {
  tracks: () => { files = tracks; window.dispatchEvent(new Event('cortex:subtitle-files-changed')) },
  noTracks: () => { files = []; window.dispatchEvent(new Event('focus')) },
  finish: () => pending?.('C:/fixture/video.subtitled.mp4'), request: () => request,
  result: () => ({ opened, canceled }), language: lang => useSettingsStore.setState({ lang }),
}
useSettingsStore.setState({ lang: 'en' })
useDownloadStore.getState().loadTasks([{ id: 'fixture', url: 'https://example.test/video', title: 'Nightcore - If U Seek Amy - (Lyrics)',
  filename: 'video.mp4', filePath: 'C:/fixture/video.mp4', targetFormat: 'mp4', status: 'completed', phase: 'completed', downloadedBytes: 396447159, totalBytes: 396447159, outputBytes: 396447159, overallProgress: 100, phaseProgress: 100, thumbnail: null }])
createRoot(document.getElementById('root')).render(<DownloadCard id="fixture" onOpenFile={file => { opened = file }} onOpenFolder={() => {}} onDelete={() => {}} onError={() => {}} />)
