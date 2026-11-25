// Persisted user preferences, engine health/update state, and app-level settings actions.
import { create } from 'zustand'
import { translations, type Language } from '../translations'
import { useUIStore } from './useUIStore'
import { initialAppUpdateState, type AppUpdateState } from '../../../Shared/appUpdate'

const currentAppVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

function storageGet(key: string): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
}

function storageSet(key: string, value: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
}

function readInitialLanguage(): Language {
  const saved = storageGet('language')
  return saved === 'ar' ? 'ar' : 'en'
}

function readInitialConcurrency(): number {
  const saved = parseInt(storageGet('cortex-concurrent') || '', 10)
  return [3, 5, 10].includes(saved) ? saved : 3
}

interface SettingsStoreState {
  lang: Language
  setLang: (lang: Language) => void

  concurrentDownloads: number
  setConcurrentDownloads: (v: number, persist?: boolean) => void

  useInAppPlayer: boolean
  setUseInAppPlayer: (v: boolean) => void

  refreshWindowsPlayerArtwork: boolean
  setRefreshWindowsPlayerArtwork: (v: boolean) => void

  totalDownloadedBytes: number
  setTotalDownloadedBytes: (updater: number | ((prev: number) => number)) => void

  updateState: AppUpdateState
  updateModalOpen: boolean
  updateDismissedVersion: string | null
  applyUpdateState: (next: AppUpdateState) => void
  openUpdateModal: () => void
  closeUpdateModal: () => void

  engineVersion: string
  setEngineVersion: (v: string) => void

  engineUpdateStatus: { updating: boolean; message?: string; success?: boolean } | null
  setEngineUpdateStatus: (
    v: { updating: boolean; message?: string; success?: boolean } | null,
  ) => void

  healthCheck: AppHealthCheck | null
  setHealthCheck: (v: AppHealthCheck | null) => void

  healthChecking: boolean
  setHealthChecking: (v: boolean) => void

  username: string
  setUsername: (v: string) => void
  password: string
  setPassword: (v: string) => void

  refreshHealth: () => Promise<void>
  onCheckForUpdates: () => Promise<void>
  onDownloadUpdate: () => Promise<void>
  onCancelUpdateDownload: () => Promise<void>
  onUpdateEngine: () => Promise<void>
  onResetStats: () => void
  onRestartAndInstall: () => Promise<void>
  onUninstall: () => void
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  lang: readInitialLanguage(),
  setLang: lang => set({ lang: lang === 'ar' ? 'ar' : 'en' }),

  concurrentDownloads: readInitialConcurrency(),
  setConcurrentDownloads: (v, persist = true) => {
    const normalized = [3, 5, 10].includes(v) ? v : 3
    if (persist) {
      storageSet('cortex-concurrent', String(normalized))
      window.cortexDl?.setConcurrency?.(normalized).catch(() => {})
    }
    set({ concurrentDownloads: normalized })
  },

  // Default player and Windows artwork refresh options to enabled unless explicitly turned off.
  useInAppPlayer: storageGet('cortex-inapp-player') !== 'false',
  setUseInAppPlayer: v => {
    storageSet('cortex-inapp-player', String(v))
    set({ useInAppPlayer: v })
  },

  refreshWindowsPlayerArtwork: storageGet('cortex-refresh-windows-artwork') !== 'false',
  setRefreshWindowsPlayerArtwork: v => {
    storageSet('cortex-refresh-windows-artwork', String(v))
    set({ refreshWindowsPlayerArtwork: v })
  },

  totalDownloadedBytes: parseInt(storageGet('cortex-total-bytes') || '0', 10),
  setTotalDownloadedBytes: updater =>
    set(state => ({
      totalDownloadedBytes:
        typeof updater === 'function' ? updater(state.totalDownloadedBytes) : updater,
    })),

  updateState: initialAppUpdateState(currentAppVersion),
  updateModalOpen: false,
  updateDismissedVersion: null,
  applyUpdateState: next =>
    set(state => {
      const prev = state.updateState
      let updateModalOpen = state.updateModalOpen
      let updateDismissedVersion = state.updateDismissedVersion

      if (next.phase === 'available') {
        const isFreshVersion =
          !!next.latestVersion && next.latestVersion !== state.updateDismissedVersion
        const justFinishedManualCheck = next.manualCheck && prev.phase === 'checking'
        if (isFreshVersion || justFinishedManualCheck) {
          updateModalOpen = true
          if (justFinishedManualCheck) updateDismissedVersion = null
        }
      } else if (next.phase === 'downloaded') {
        if (prev.phase !== 'downloaded') {
          updateModalOpen = true
        }
      } else if (next.phase === 'up-to-date' || next.phase === 'idle') {
        updateModalOpen = false
      }

      return { updateState: next, updateModalOpen, updateDismissedVersion }
    }),
  openUpdateModal: () => set({ updateModalOpen: true }),
  closeUpdateModal: () =>
    set(state => ({
      updateModalOpen: false,
      updateDismissedVersion:
        state.updateState.phase === 'available' && state.updateState.latestVersion
          ? state.updateState.latestVersion
          : state.updateDismissedVersion,
    })),

  engineVersion: '...',
  setEngineVersion: v => set({ engineVersion: v }),

  engineUpdateStatus: null,
  setEngineUpdateStatus: v => set({ engineUpdateStatus: v }),

  healthCheck: null,
  setHealthCheck: v => set({ healthCheck: v }),

  healthChecking: true,
  setHealthChecking: v => set({ healthChecking: v }),

  username: '',
  setUsername: v => set({ username: v }),
  password: '',
  setPassword: v => set({ password: v }),

  refreshHealth: async () => {
    set({ healthChecking: true })
    try {
      const [health, jsRuntime] = await Promise.all([
        window.cortexDl.getHealthCheck(),
        window.cortexDl.checkJsRuntime(),
      ])
      set({ healthCheck: { ...health, jsRuntime }, engineVersion: health.ytDlp.version })
    } catch (err) {
      console.error('Health check failed:', err)
      set({ healthCheck: null })
    } finally {
      set({ healthChecking: false })
    }
  },

  onCheckForUpdates: async () => {
    const current = get().updateState
    if (current.phase === 'downloading' || current.phase === 'downloaded') {
      set({ updateModalOpen: true })
      return
    }
    set({
      updateState: {
        ...current,
        phase: 'checking',
        errorCode: null,
        errorDetail: null,
        manualCheck: true,
      },
    })
    try {
      const next = await window.cortexDl.checkForUpdates()
      if (next) get().applyUpdateState(next)
    } catch (err) {
      console.error(err)
      set(state => ({
        updateState: {
          ...state.updateState,
          phase: 'error',
          errorCode: 'unknown',
          errorDetail: err instanceof Error ? err.message : null,
          manualCheck: true,
        },
      }))
    }
  },

  onDownloadUpdate: async () => {
    set({ updateModalOpen: true })
    try {
      const next = await window.cortexDl.downloadUpdate()
      if (next) get().applyUpdateState(next)
    } catch (err) {
      console.error(err)
      set(state => ({
        updateState: {
          ...state.updateState,
          phase: 'error',
          errorCode: 'download',
          errorDetail: err instanceof Error ? err.message : null,
        },
      }))
    }
  },

  onCancelUpdateDownload: async () => {
    try {
      const next = await window.cortexDl.cancelUpdateDownload()
      if (next) get().applyUpdateState(next)
    } catch (err) {
      console.error(err)
    }
  },

  onUpdateEngine: async () => {
    const t = translations[get().lang]
    set({ engineUpdateStatus: { updating: true, message: t.updating_engine } })
    try {
      const result = await window.cortexDl.updateEngine()
      if (result.success) {
        set({ engineUpdateStatus: { updating: false, success: true, message: result.message } })
        if (result.version) set({ engineVersion: result.version })
        else set({ engineVersion: await window.cortexDl.getEngineVersion() })
        await get().refreshHealth()
        setTimeout(() => set({ engineUpdateStatus: null }), 5000)
      } else {
        set({ engineUpdateStatus: { updating: false, success: false, message: result.message } })
        setTimeout(() => set({ engineUpdateStatus: null }), 5000)
      }
    } catch (err) {
      console.error('Engine update error:', err)
      set({
        engineUpdateStatus: { updating: false, success: false, message: t.engine_update_failed },
      })
      setTimeout(() => set({ engineUpdateStatus: null }), 5000)
    }
  },

  onResetStats: () => {
    const t = translations[get().lang]
    useUIStore.getState().setModalConfig({
      isOpen: true,
      title: t.reset_stats,
      message: t.confirm_reset_stats,
      confirmText: t.modal_confirm,
      cancelText: t.modal_cancel,
      type: 'warning',
      onConfirm: () => {
        set({ totalDownloadedBytes: 0 })
        localStorage.setItem('cortex-total-bytes', '0')
        useUIStore.getState().closeModal()
      },
    })
  },

  onRestartAndInstall: async () => {
    try {
      await window.cortexDl.restartApp()
    } catch (err) {
      console.error(err)
    }
  },

  onUninstall: () => {
    const t = translations[get().lang]
    useUIStore.getState().setModalConfig({
      isOpen: true,
      title: t.settings_modal_title,
      message: t.settings_modal_desc,
      confirmText: t.settings_confirm_uninstall,
      cancelText: t.settings_cancel,
      type: 'danger',
      onConfirm: async () => {
        try {
          await window.cortexDl.uninstallApp()
        } catch {
          // Fall back to Windows Apps & Features if the built-in uninstaller cannot be launched.
          await window.cortexDl.openExternal('ms-settings:appsfeatures')
        }
        useUIStore.getState().closeModal()
      },
    })
  },
}))

export const useLang = () => useSettingsStore(s => s.lang)

export const useTranslations = () => translations[useSettingsStore(s => s.lang)]
