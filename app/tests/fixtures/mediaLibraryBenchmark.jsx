import React from 'react'
import { createRoot } from 'react-dom/client'
import MediaLibrary from '../../Front-End/src/components/MediaLibrary'
import { useMediaLibraryStore as store } from '../../Front-End/src/stores/useMediaLibraryStore'
import { useUIStore } from '../../Front-End/src/stores/useUIStore'
import '../../Front-End/src/App.css'

const { ipcRenderer } = window.require('electron')
const localNow = () => performance.timeOrigin + performance.now()
let clockOffset = 0
const now = () => localNow() + clockOffset
let timing
const invoke = async (channel, ...args) => {
  const start = now(), result = await ipcRenderer.invoke('cortexdl:library:' + channel, ...args), end = now()
  if (channel === 'add' || channel === 'select') Object.assign(timing, { requestSent: start, responseReceived: end, ipcMs: end - start })
  return result
}
window.cortexDl = {
  listMediaLibrary: () => invoke('list'), checkMediaLibraryFiles: ids => invoke('check', ids),
  addMediaLibraryFiles: paths => invoke('add', paths), selectMediaLibraryFiles: () => invoke('select'),
  getMediaLibraryArtworkInfo: id => invoke('artwork-info', id),
  playMediaLibraryItem: id => invoke('play', id),
}
useUIStore.setState({ activeTab: 'library' })
localStorage.setItem('cortexdl_library_page_size', '4')
store.subscribe((next, previous) => {
  if (timing && next.items !== previous.items && next.items.length && !timing.stateApplied) timing.stateApplied = now()
})
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
async function run(paths) {
  store.setState({ items: [], loaded: true, imported: null, artworkInfo: {} })
  await paint()
  timing = { start: now() }
  const imageLoaded = event => {
    if (!timing.imageLoaded && event.target.matches?.('.library-thumbnail img')) timing.imageLoaded = now()
  }
  document.addEventListener('load', imageLoaded, true)
  let card
  const observer = new MutationObserver(() => {
    if (!card && document.querySelector('.library-card')) card = now()
  })
  observer.observe(document.getElementById('root'), { subtree: true, childList: true })
  await store.getState().importFiles(paths)
  await paint()
  timing.cardCommitted = card
  timing.cardPainted = now()
  observer.disconnect()
  const deadline = now() + 10000
  while (!Array.from(document.querySelectorAll('.library-thumbnail img')).some(img => img.naturalWidth > 0) && now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  await paint()
  timing.imagePainted = now()
  timing.hasImage = Array.from(document.querySelectorAll('.library-thumbnail img')).some(img => img.naturalWidth > 0)
  document.removeEventListener('load', imageLoaded, true)
  return timing
}
window.benchmark = { run, refresh: () => store.getState().refresh(), play: () => store.getState().play(store.getState().items[0].id),
  calibrate: async () => {
    let best
    for (let i = 0; i < 20; i++) {
      const start = localNow(), main = await ipcRenderer.invoke('benchmark:clock'), end = localNow()
      if (!best || end - start < best.roundTripMs) best = { offsetMs: main - (start + end) / 2, roundTripMs: end - start }
    }
    clockOffset = best.offsetMs
    return best
  },
  ready: () => store.getState().loaded && !store.getState().loading }
createRoot(document.getElementById('root')).render(<div className="app-container"><main className="main-content"><MediaLibrary /></main></div>)
