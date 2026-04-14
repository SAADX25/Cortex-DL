/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  UI Store — Global UI state managed by Zustand.
 *
 *  These states were previously scattered across useState hooks in
 *  useAppController, causing the entire App tree to re-render whenever
 *  any of them changed.  By moving them to a Zustand store, each
 *  component can subscribe to ONLY the slices it needs via selectors.
 *
 *  Pattern: matches the existing downloadStore.ts approach.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { create } from 'zustand'
import type { BatchItem } from '../components/AddDownloadTab'

// ── Types ────────────────────────────────────────────────────────────────────

export type ActiveTab = 'add' | 'downloads' | 'settings'

interface UIStoreState {
  // ── Navigation ──
  activeTab: ActiveTab
  setActiveTab: (tab: ActiveTab) => void

  // ── Download directory ──
  directory: string | null
  setDirectory: (dir: string | null) => void

  // ── Global error banner ──
  globalError: string | null
  setGlobalError: (err: string | null) => void

  // ── Batch items list ──
  batchItems: BatchItem[]
  setBatchItems: (updater: BatchItem[] | ((prev: BatchItem[]) => BatchItem[])) => void

  // ── Toast messages ──
  toastMsg: string | null
  showToast: (msg: string) => void

  // ── URL input ──
  url: string
  setUrl: (url: string) => void

  // ── Analysis state ──
  analyzeResult: AnalyzeResult | null
  setAnalyzeResult: (result: AnalyzeResult | null) => void
  analyzing: boolean
  setAnalyzing: (v: boolean) => void
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useUIStore = create<UIStoreState>((set) => ({
  // Navigation
  activeTab: 'add',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Directory — hydrate from localStorage
  directory: localStorage.getItem('cortex-directory'),
  setDirectory: (dir) => {
    if (dir) localStorage.setItem('cortex-directory', dir)
    set({ directory: dir })
  },

  // Global error
  globalError: null,
  setGlobalError: (err) => set({ globalError: err }),

  // Batch items
  batchItems: [],
  setBatchItems: (updater) =>
    set((state) => ({
      batchItems: typeof updater === 'function' ? updater(state.batchItems) : updater,
    })),

  // Toast
  toastMsg: null,
  showToast: (msg) => {
    set({ toastMsg: msg })
    setTimeout(() => set({ toastMsg: null }), 2300)
  },

  // URL
  url: '',
  setUrl: (url) => set({ url }),

  // Analysis
  analyzeResult: null,
  setAnalyzeResult: (result) => set({ analyzeResult: result }),
  analyzing: false,
  setAnalyzing: (v) => set({ analyzing: v }),
}))

// ── Selectors (for fine-grained subscriptions) ───────────────────────────────

/** Active tab — only re-renders when tab changes */
export const useActiveTab = () => useUIStore((s) => s.activeTab)
export const useSetActiveTab = () => useUIStore((s) => s.setActiveTab)

/** Directory — only re-renders when directory changes */
export const useDirectory = () => useUIStore((s) => s.directory)

/** Global error — only re-renders when error changes */
export const useGlobalError = () => useUIStore((s) => s.globalError)

/** Batch items — only re-renders when batch array changes */
export const useBatchItems = () => useUIStore((s) => s.batchItems)

/** Toast — only re-renders when toast message changes */
export const useToast = () => useUIStore((s) => s.toastMsg)

/** URL — only re-renders when URL changes */
export const useUrl = () => useUIStore((s) => s.url)

/** Analysis — only re-renders when analysis result or analyzing state changes */
export const useAnalyzeResult = () => useUIStore((s) => s.analyzeResult)
export const useAnalyzing = () => useUIStore((s) => s.analyzing)
