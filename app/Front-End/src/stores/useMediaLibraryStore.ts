import { create } from 'zustand'
import { useUIStore } from './useUIStore'
import { useSettingsStore } from './useSettingsStore'
import type { LibraryMediaItem, LibraryImportResult } from '../../../Shared/mediaLibrary'
type ArtworkTask = { id: string; action: 'change' | 'remove' | 'embed' }

interface LibraryState {
  items: LibraryMediaItem[]
  loaded: boolean
  refreshVersion: number
  loading: boolean
  busy: boolean
  error: string | null
  imported: LibraryImportResult | null
  importCount: number | null
  artworkInfo: Record<string, boolean>
  artworkTask: ArtworkTask | null
  setArtworkInfo: (id: string, embedded: boolean) => void
  refresh: () => Promise<void>
  checkFiles: (ids: string[]) => Promise<void>
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
    finally { set({ busy: false, artworkTask: null, importCount: null }) }
  }
  return {
    items: [], loaded: false, refreshVersion: 0, loading: false, busy: false, error: null, imported: null, importCount: null, artworkInfo: {}, artworkTask: null,
    setArtworkInfo: (id, embedded) => set(state => state.artworkInfo[id] === embedded ? state : { artworkInfo: { ...state.artworkInfo, [id]: embedded } }),
    refresh: () => {
      if (get().busy) return Promise.resolve()
      if (refreshPending) return refreshPending
      const current = revision
      set({ loading: true })
      refreshPending = window.cortexDl.listMediaLibrary().then(items => {
        if (current === revision) set(state => ({ items, loaded: true, error: null, refreshVersion: state.refreshVersion + 1 }))
      }).catch(error => {
        if (current === revision) set({ error: errorMessage(error) })
      }).finally(() => { refreshPending = null; set({ loading: false }) })
      return refreshPending
    },
    checkFiles: async ids => {
      if (get().busy || !ids.length) return
      const current = revision, version = get().refreshVersion
      try {
        const checked = await window.cortexDl.checkMediaLibraryFiles(ids)
        if (current !== revision || version !== get().refreshVersion) return
        const statuses = new Map(checked.map(item => [item.id, item]))
        set(state => ({ items: state.items.map(item => {
          const fresh = statuses.get(item.id)
          return fresh && fresh.filePath === item.filePath && (fresh.availability !== item.availability || fresh.size !== item.size)
            ? { ...item, availability: fresh.availability, size: fresh.size } : item
        }) }))
      } catch { /* Playback validates availability again; a failed check is retryable. */ }
    },
    importFiles: paths => perform(async () => {
      if (!paths || paths.length >= 100) set({ importCount: paths?.length ?? 0 })
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
      if (items) set(state => ({ items, artworkInfo: {}, refreshVersion: state.refreshVersion + 1 }))
    }),
    selectArtwork: (id, suspend) => perform(async () => {
      if (!suspend) checkCoverEdit(id)
      const resume = await suspend?.()
      try {
        const items = await window.cortexDl.selectMediaLibraryArtwork(id, useSettingsStore.getState().refreshWindowsPlayerArtwork)
        if (items) set(state => ({ items, artworkInfo: {}, refreshVersion: state.refreshVersion + 1 }))
      } finally { resume?.() }
    }, { id, action: 'change' }),
    removeArtwork: (id, suspend) => perform(async () => {
      if (!suspend) checkCoverEdit(id)
      const resume = await suspend?.()
      try {
        const items = await window.cortexDl.removeMediaLibraryArtwork(id, useSettingsStore.getState().refreshWindowsPlayerArtwork)
        set(state => ({ items, artworkInfo: {}, refreshVersion: state.refreshVersion + 1 }))
      }
      finally { resume?.() }
    }, { id, action: 'remove' }),
    embedArtwork: id => perform(async () => {
      checkCoverEdit(id)
      const items = await window.cortexDl.embedMediaLibraryArtwork(id, useSettingsStore.getState().refreshWindowsPlayerArtwork)
      set(state => ({ items, artworkInfo: {}, refreshVersion: state.refreshVersion + 1 }))
    }, { id, action: 'embed' }),
    dismissNotice: () => set({ imported: null, error: null }),
  }
})
