import { create } from 'zustand'
import { useUIStore } from './useUIStore'
import type { LibraryMediaItem, LibraryImportResult } from '../../../Shared/mediaLibrary'
type ArtworkTask = { id: string; action: 'change' | 'remove' | 'embed' }

interface LibraryState {
  items: LibraryMediaItem[]
  loaded: boolean
  loading: boolean
  busy: boolean
  error: string | null
  imported: LibraryImportResult | null
  artworkInfo: Record<string, boolean>
  artworkTask: ArtworkTask | null
  setArtworkInfo: (id: string, embedded: boolean) => void
  refresh: () => Promise<void>
  importFiles: (paths?: string[]) => Promise<void>
  remove: (id: string) => Promise<void>
  play: (id: string) => Promise<void>
  relocate: (id: string) => Promise<void>
  selectArtwork: (id: string, suspend?: () => Promise<() => void>) => Promise<void>
  removeArtwork: (id: string, suspend?: () => Promise<() => void>) => Promise<void>
  embedArtwork: (id: string) => Promise<void>
  dismissNotice: () => void
}
let revision = 0
let refreshPending: Promise<void> | null = null
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'MEDIA_LIBRARY_REQUEST_FAILED'

export const useMediaLibraryStore = create<LibraryState>((set, get) => {
  const checkCoverEdit = (id: string) => {
    const file = get().items.find(item => item.id === id)?.filePath, player = useUIStore.getState().mediaPlayerFile?.filePath
    const key = (path: string) => path.replace(/\\/g, '/').toLowerCase()
    if (file && player && key(file) === key(player)) throw new Error('MEDIA_LIBRARY_ARTWORK_PLAYING')
  }
  const perform = async (action: () => Promise<void>, artworkTask: ArtworkTask | null = null) => {
    if (get().busy) return
    revision++
    set({ busy: true, error: null, imported: null, artworkTask })
    try { await action() }
    catch (error) { set({ error: errorMessage(error) }) }
    finally { set({ busy: false, artworkTask: null }) }
  }
  return {
    items: [], loaded: false, loading: false, busy: false, error: null, imported: null, artworkInfo: {}, artworkTask: null,
    setArtworkInfo: (id, embedded) => set(state => state.artworkInfo[id] === embedded ? state : { artworkInfo: { ...state.artworkInfo, [id]: embedded } }),
    refresh: () => {
      if (get().busy) return Promise.resolve()
      if (refreshPending) return refreshPending
      const current = revision
      set({ loading: true })
      refreshPending = window.cortexDl.listMediaLibrary().then(items => {
        if (current === revision) set({ items, loaded: true, error: null, artworkInfo: {} })
      }).catch(error => {
        if (current === revision) set({ error: errorMessage(error) })
      }).finally(() => { refreshPending = null; set({ loading: false }) })
      return refreshPending
    },
    importFiles: paths => perform(async () => {
      const result = paths ? await window.cortexDl.addMediaLibraryFiles(paths) : await window.cortexDl.selectMediaLibraryFiles()
      if (result) set({ items: result.items, loaded: true, imported: result })
    }),
    remove: id => perform(async () => { set({ items: await window.cortexDl.removeMediaLibraryItem(id) }) }),
    play: id => perform(async () => {
      const item = await window.cortexDl.playMediaLibraryItem(id)
      set(state => ({ items: state.items.map(entry => entry.id === id ? item : entry) }))
      useUIStore.getState().setMediaPlayerFile({ filePath: item.filePath, title: item.name.replace(/\.[^.]+$/, '') })
    }),
    relocate: id => perform(async () => {
      const items = await window.cortexDl.relocateMediaLibraryItem(id)
      if (items) set({ items, artworkInfo: {} })
    }),
    selectArtwork: (id, suspend) => perform(async () => {
      if (!suspend) checkCoverEdit(id)
      const resume = await suspend?.()
      try {
        const items = await window.cortexDl.selectMediaLibraryArtwork(id)
        if (items) set({ items, artworkInfo: {} })
      } finally { resume?.() }
    }, { id, action: 'change' }),
    removeArtwork: (id, suspend) => perform(async () => {
      if (!suspend) checkCoverEdit(id)
      const resume = await suspend?.()
      try { set({ items: await window.cortexDl.removeMediaLibraryArtwork(id), artworkInfo: {} }) }
      finally { resume?.() }
    }, { id, action: 'remove' }),
    embedArtwork: id => perform(async () => { checkCoverEdit(id); set({ items: await window.cortexDl.embedMediaLibraryArtwork(id), artworkInfo: {} }) }, { id, action: 'embed' }),
    dismissNotice: () => set({ imported: null, error: null }),
  }
})
