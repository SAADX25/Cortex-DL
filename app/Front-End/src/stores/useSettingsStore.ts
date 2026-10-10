import { create } from 'zustand'
import { translations } from '../translations'
import type { Language } from '../translations'
import { useUIStore } from './useUIStore'

/**
 * App settings / health / update-status slice. Pulled out of the old
 * `useAppController` → `useSettingsController` god-hook chain so components
 * like Sidebar/SettingsTab/AddDownloadTab can read just `lang`, or just
 * `healthCheck`, etc. without depending on (or re-rendering for) the rest.
 */
interface SettingsStoreState {
  lang: Language
  setLang: (lang: Language) => void

  concurrentDownloads: number
  setConcurrentDownloads: (v: number) => void

  useInAppPlayer: boolean
  setUseInAppPlayer: (v: boolean) => void

  totalDownloadedBytes: number
  setTotalDownloadedBytes: (updater: number | ((prev: number) => number)) => void

  updateStatus: { status: string; percent?: number; error?: string } | null
  setUpdateStatus: (v: { status: string; percent?: number; error?: string } | null) => void

  engineVersion: string
  setEngineVersion: (v: string) => void

  engineUpdateStatus: { updating: boolean; message?: string; success?: boolean } | null
  setEngineUpdateStatus: (v: { updating: boolean; message?: string; success?: boolean } | null) => void

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
  onUpdateEngine: () => Promise<void>
  onResetStats: () => void
  onRestartAndInstall: () => Promise<void>
  onUninstall: () => void
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  lang: (localStorage.getItem('language') as Language) || 'en',
  setLang: (lang) => set({ lang }),

  concurrentDownloads: 3,
  setConcurrentDownloads: (v) => set({ concurrentDownloads: v }),

  useInAppPlayer: localStorage.getItem('cortex-inapp-player') !== 'false',
  setUseInAppPlayer: (v) => {
    localStorage.setItem('cortex-inapp-player', String(v))
    set({ useInAppPlayer: v })
  },

  totalDownloadedBytes: parseInt(localStorage.getItem('cortex-total-bytes') || '0', 10),
  setTotalDownloadedBytes: (updater) =>
    set((state) => ({
      totalDownloadedBytes: typeof updater === 'function' ? updater(state.totalDownloadedBytes) : updater,
    })),

  updateStatus: null,
  setUpdateStatus: (v) => set({ updateStatus: v }),

  engineVersion: '...',
  setEngineVersion: (v) => set({ engineVersion: v }),

  engineUpdateStatus: null,
  setEngineUpdateStatus: (v) => set({ engineUpdateStatus: v }),

  healthCheck: null,
  setHealthCheck: (v) => set({ healthCheck: v }),

  healthChecking: true,
  setHealthChecking: (v) => set({ healthChecking: v }),

  username: '',
  setUsername: (v) => set({ username: v }),
  password: '',
  setPassword: (v) => set({ password: v }),

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
    set({ updateStatus: { status: 'checking' } })
    try {
      await window.cortexDl.checkForUpdates()
    } catch (err) {
      console.error(err)
      set({ updateStatus: { status: 'error' } })
    }
  },

  onUpdateEngine: async () => {
    set({ engineUpdateStatus: { updating: true, message: 'Downloading...' } })
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
      set({ engineUpdateStatus: { updating: false, success: false, message: 'Update failed' } })
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
          await window.cortexDl.openExternal('ms-settings:appsfeatures')
        }
        useUIStore.getState().closeModal()
      },
    })
  },
}))

export const useLang = () => useSettingsStore((s) => s.lang)
export const useTranslations = () => translations[useSettingsStore((s) => s.lang)]
