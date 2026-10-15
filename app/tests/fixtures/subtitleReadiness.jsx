import React from 'react'
import { createRoot } from 'react-dom/client'
import SubtitleStudio from '../../Front-End/src/components/Subtitles/SubtitleStudio'
import { useUIStore } from '../../Front-End/src/stores/useUIStore'
import { useSubtitleStudioStore } from '../../Front-End/src/stores/useSubtitleStudioStore'
import { useSettingsStore } from '../../Front-End/src/stores/useSettingsStore'

let state = { id: '', stage: 'idle', progress: null }
let installed = false, installs = 0, cleared = 0
let lastRequest
let gpuDetected = false, gpuPrepared = false
useSettingsStore.setState({ lang: 'en' })
useUIStore.setState({ activeTab: 'subtitles' })
useSubtitleStudioStore.setState({ source: 'C:/Videos/example.mp4' })
window.cortexDl = {
  getLocalSubtitleState: async () => { await new Promise(r => setTimeout(r, 20)); return { ...state } },
  getLocalSubtitleReadiness: async () => {
    const snapshot = { speech: { accurate: installed, fast: false }, translation: { standard: installed, quality: false }, ramGB: 16, cpu: { name: 'Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz' } }
    if (gpuDetected) snapshot.gpu = { name: 'NVIDIA GeForce GTX 1050 Ti', memoryMB: 4096, speech: { accurate: gpuPrepared, fast: false }, translation: gpuPrepared }
    // Real IPC resolves after React has committed the terminal operation state.
    await new Promise(r => setTimeout(r, 80))
    return snapshot
  },
  installSubtitleModels: async () => { installs++; state = { id: 'installation', stage: 'installing', progress: 25 }; return state.id },
  startLocalSubtitles: async request => { lastRequest = request; state = { id: 'recognition', stage: 'transcribing', progress: null, acceleration: { speech: request.compute === 'auto' && gpuPrepared ? 'gpu' : 'cpu', translation: 'cpu', device: 'NVIDIA GeForce GTX 1050 Ti' } }; return state.id },
  clearLocalSubtitles: async id => { if (id !== state.id) throw Error('Stale session'); cleared++; state = { id: '', stage: 'idle', progress: null }; return state },
}
window.fixture = {
  complete: () => { installed = true; if (gpuDetected) gpuPrepared = true; state = { id: 'installation', stage: 'idle', progress: null } },
  models: value => { installed = value },
  tab: value => useUIStore.setState({ activeTab: value }),
  installs: () => installs,
  request: () => lastRequest,
  noSpeech: () => { state = { id: 'recognition', stage: 'error', error: 'LOCAL_SUBTITLES_NO_SPEECH', progress: null } },
  invalidTiming: () => { state = { id: 'recognition', stage: 'error', error: 'Speech engine returned invalid timing', progress: null } },
  retryTiming: () => { state = { id: 'recognition', stage: 'transcribing', detail: 'retrying-speech-timing', progress: null } },
  language: lang => useSettingsStore.setState({ lang }),
  gpu: () => { gpuDetected = true; window.dispatchEvent(new Event('focus')) },
  done: () => {
    state = { id: 'recognition', stage: 'ready', progress: 100, document: { id: 'recognition', name: 'Session fixture', localFile: 'C:/Videos/example.mp4', sourceLanguage: 'en', targetLanguage: 'ar', duration: 10, cues: [{ id: 1, start: 0, end: 3, original: 'Hello', text: 'مرحبًا', review: true }] } }
    useUIStore.setState({ mediaPlayerFile: { filePath: 'C:/Videos/example.mp4', subtitlePreview: { language: 'ar', vtt: 'WEBVTT\n' } } })
  },
  cleared: () => ({ count: cleared, state, source: useSubtitleStudioStore.getState().source, preview: useUIStore.getState().mediaPlayerFile }),
}
createRoot(document.getElementById('root')).render(<SubtitleStudio />)
