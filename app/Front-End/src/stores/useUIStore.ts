import { create } from 'zustand'
import type { BatchItem } from '../components/AddDownloadTab'


export type ActiveTab = 'add' | 'downloads' | 'settings'

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
}))


/** Active tab */
export const useActiveTab = () => useUIStore((s) => s.activeTab)
export const useSetActiveTab = () => useUIStore((s) => s.setActiveTab)

/** Directory */
export const useDirectory = () => useUIStore((s) => s.directory)

/** Global error */
export const useGlobalError = () => useUIStore((s) => s.globalError)

/** Batch items */
export const useBatchItems = () => useUIStore((s) => s.batchItems)

/** Toast */
export const useToast = () => useUIStore((s) => s.toastMsg)

/** URL */
export const useUrl = () => useUIStore((s) => s.url)

/** Analysis */
export const useAnalyzeResult = () => useUIStore((s) => s.analyzeResult)
export const useAnalyzing = () => useUIStore((s) => s.analyzing)
