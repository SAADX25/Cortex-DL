import { create } from 'zustand'

interface CommentsStoreState {
  isCommentsDownloading: boolean
  setIsCommentsDownloading: (v: boolean) => void

  commentsSuccessPath: string | null
  setCommentsSuccessPath: (v: string | null) => void

  commentsProgress: { current: number; total: number } | null
  setCommentsProgress: (v: { current: number; total: number } | null) => void
}

export const useCommentsStore = create<CommentsStoreState>((set) => ({
  isCommentsDownloading: false,
  setIsCommentsDownloading: (v) => set({ isCommentsDownloading: v }),

  commentsSuccessPath: null,
  setCommentsSuccessPath: (v) => set({ commentsSuccessPath: v }),

  commentsProgress: null,
  setCommentsProgress: (v) => set({ commentsProgress: v }),
}))

let ipcInitialized = false

export function initCommentsStore(): () => void {
  if (ipcInitialized) return () => {}
  ipcInitialized = true

  const disposeStarted = window.cortexDl.onCommentsExtractionStarted(() => {
    useCommentsStore.setState({
      commentsProgress: null,
      commentsSuccessPath: null,
      isCommentsDownloading: true,
    })
  })
  const disposeProgress = window.cortexDl.onCommentsProgress((current, total) => {
    useCommentsStore.setState({ commentsProgress: { current, total } })
  })

  return () => {
    disposeStarted()
    disposeProgress()
    ipcInitialized = false
  }
}
