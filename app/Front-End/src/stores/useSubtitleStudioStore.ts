import { create } from 'zustand'
import { useUIStore } from './useUIStore'

export const useSubtitleStudioStore = create<{ source: string; setSource: (source: string) => void }>(set => ({ source: '', setSource: source => set({ source }) }))
export function openSubtitleStudio(source: string): void {
  useSubtitleStudioStore.getState().setSource(source)
  useUIStore.getState().setActiveTab('subtitles')
}
