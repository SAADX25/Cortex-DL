import React from 'react'
import { createRoot } from 'react-dom/client'
import AddDownloadTab from '../../Front-End/src/components/AddDownloadTab'
import { useUIStore } from '../../Front-End/src/stores/useUIStore'
import { useSettingsStore } from '../../Front-End/src/stores/useSettingsStore'
import '../../Front-End/src/App.css'
let requests = 0
window.cortexDl = {
  analysisDebug: false, onAnalysisUpdate: () => () => {}, cancelAnalysis: async () => {},
  analyzeUrl: async () => { requests++; throw new Error('YOUTUBE_BOT_VERIFICATION') },
}
window.fixture = {
  language: lang => { useSettingsStore.setState({ lang }); useUIStore.setState({ globalError: null }) },
  batch: () => useUIStore.setState({ batchItems: [{ id: 'fixture', url: 'https://example.test/video', title: 'Video', format: 'mp4' }] }),
  requests: () => requests,
}
useSettingsStore.setState({ lang: 'en' })
useUIStore.setState({ url: 'https://www.youtube.com/watch?v=SI4OiWuavm0', directory: 'C:/Downloads', batchItems: [], analyzeResult: null, globalError: null })
createRoot(document.getElementById('root')).render(<AddDownloadTab />)
