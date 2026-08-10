import { create } from 'zustand'
import type { BatchItem } from '../components/AddDownloadTab'
import type { ModalConfig } from '../hooks/types'

export type ActiveTab = 'add' | 'downloads' | 'settings'

export type MediaPlayerFile = { filePath: string; title?: string }

const DEFAULT_MODAL_CONFIG: ModalConfig = {
  isOpen: false,
  title: '',
  message: '',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  onConfirm: () => {},
  type: 'danger',
}

interface UIStoreState {
  activeTab: ActiveTab
  setActiveTab: (tab: ActiveTab) => void

  directory: string | null
  setDirectory: (dir: string | null) => void

  globalError: string | null
  setGlobalError: (err: string | null) => void

  batchItems: BatchItem[]
  setBatchItems: (updater: BatchItem[] | ((prev: BatchItem[]) => BatchItem[])) => void

  toastMsg: string | null
  showToast: (msg: string) => void

  url: string
  setUrl: (url: string) => void

  analyzeResult: AnalyzeResult | null
  setAnalyzeResult: (result: AnalyzeResult | null) => void
  analyzing: boolean
  setAnalyzing: (v: boolean) => void

  
  modalConfig: ModalConfig
  setModalConfig: (updater: ModalConfig | ((prev: ModalConfig) => ModalConfig)) => void
  closeModal: () => void

  
  mediaPlayerFile: MediaPlayerFile | null
  setMediaPlayerFile: (file: MediaPlayerFile | null) => void
}

export const useUIStore = create<UIStoreState>((set) => ({
  
  activeTab: 'add',
  setActiveTab: (tab) => set({ activeTab: tab }),

  
  directory: localStorage.getItem('cortex-directory'),
  setDirectory: (dir) => {
    if (dir) localStorage.setItem('cortex-directory', dir)
    set({ directory: dir })
  },

  
  globalError: null,
  setGlobalError: (err) => set({ globalError: err }),

  
  batchItems: [],
  setBatchItems: (updater) =>
    set((state) => ({
      batchItems: typeof updater === 'function' ? updater(state.batchItems) : updater,
    })),

  
  toastMsg: null,
  showToast: (msg) => {
    set({ toastMsg: msg })
    setTimeout(() => set({ toastMsg: null }), 2300)
  },

  
  url: '',
  setUrl: (url) => set({ url }),

  
  analyzeResult: null,
  setAnalyzeResult: (result) => set({ analyzeResult: result }),
  analyzing: false,
  setAnalyzing: (v) => set({ analyzing: v }),

  
  modalConfig: DEFAULT_MODAL_CONFIG,
  setModalConfig: (updater) =>
    set((state) => ({
      modalConfig: typeof updater === 'function' ? updater(state.modalConfig) : updater,
    })),
  closeModal: () => set((state) => ({ modalConfig: { ...state.modalConfig, isOpen: false } })),

  
  mediaPlayerFile: null,
  setMediaPlayerFile: (file) => set({ mediaPlayerFile: file }),
}))

export const useActiveTab = () => useUIStore((s) => s.activeTab)
export const useSetActiveTab = () => useUIStore((s) => s.setActiveTab)

export const useDirectory = () => useUIStore((s) => s.directory)

export const useGlobalError = () => useUIStore((s) => s.globalError)

export const useBatchItems = () => useUIStore((s) => s.batchItems)

export const useToast = () => useUIStore((s) => s.toastMsg)

export const useUrl = () => useUIStore((s) => s.url)

export const useAnalyzeResult = () => useUIStore((s) => s.analyzeResult)
export const useAnalyzing = () => useUIStore((s) => s.analyzing)

export const useModalConfig = () => useUIStore((s) => s.modalConfig)
export const useMediaPlayerFile = () => useUIStore((s) => s.mediaPlayerFile)
