import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PlayerControls } from '../../Front-End/src/components/MediaPlayer/PlayerControls'
import { useSettingsStore } from '../../Front-End/src/stores/useSettingsStore'
import '../../Front-End/src/components/MediaPlayer/MediaPlayer.css'

useSettingsStore.setState({ lang: 'en' })
let changes = [], escapes = 0, plays = 0
window.addEventListener('keydown', event => { if (event.key === 'Escape') escapes++; if (event.key === ' ') plays++ })
window.fixture = { result: () => ({ changes, escapes, plays }), language: lang => useSettingsStore.setState({ lang }) }
function Fixture() {
  const [active, setActive] = useState(0), ref = useRef(null)
  return <div style={{ background: '#080e19', height: '100vh', position: 'relative' }}>
    <button id="outside" style={{ margin: 20 }}>Outside</button>
    <div className="player-footer"><PlayerControls mediaRef={ref} mediaType="video" isPlaying duration={323} volume={1} isMuted={false} playbackSpeed={1} showSettings={false}
      subtitles={[{ language: 'ar', label: 'ar' }, { language: 'en', label: 'English SDH' }, { language: 'invalid code', label: 'Custom commentary' }]}
      activeSubtitle={active} onSubtitleChange={index => { changes.push(index); setActive(index) }} togglePlay={() => { plays++ }}
      onSeek={() => {}} onVolumeChange={() => {}} toggleMute={() => {}} onSpeedChange={() => {}} toggleSettings={() => {}} togglePiP={() => {}} toggleFullscreen={() => {}} />
    </div>
  </div>
}
createRoot(document.getElementById('root')).render(<Fixture />)
