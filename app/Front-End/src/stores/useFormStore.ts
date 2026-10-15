import { create } from 'zustand'
import { useMemo } from 'react'
import { useUIStore } from './useUIStore'

interface FormStoreState {
  startTime: string
  setStartTime: (v: string) => void
  endTime: string
  setEndTime: (v: string) => void

  selectedVariantUrl: string | null
  setSelectedVariantUrl: (v: string | null) => void

  targetFormat: TargetFormat
  setTargetFormat: (v: TargetFormat) => void

  isAudioMode: boolean
  setIsAudioMode: (v: boolean) => void

  selectedQuality: string
  setSelectedQuality: (v: string) => void

  selectedYtdlpFormatId: string | null
  setSelectedYtdlpFormatId: (v: string | null) => void

  speedLimit: string
  setSpeedLimit: (v: string) => void

  subfolderName: string
  setSubfolderName: (v: string) => void

  resetForNewUrl: () => void
}

export const useFormStore = create<FormStoreState>((set) => ({
  startTime: '',
  setStartTime: (v) => set({ startTime: v }),
  endTime: '',
  setEndTime: (v) => set({ endTime: v }),

  selectedVariantUrl: null,
  setSelectedVariantUrl: (v) => set({ selectedVariantUrl: v }),

  targetFormat: 'mp4',
  setTargetFormat: (v) => set({ targetFormat: v }),

  isAudioMode: false,
  setIsAudioMode: (v) => set({ isAudioMode: v }),

  selectedQuality: '',
  setSelectedQuality: (v) => set({ selectedQuality: v }),

  selectedYtdlpFormatId: null,
  setSelectedYtdlpFormatId: (v) => set({ selectedYtdlpFormatId: v }),

  speedLimit: localStorage.getItem('cortex-speed-limit') || 'auto',
  setSpeedLimit: (v) => {
    localStorage.setItem('cortex-speed-limit', v)
    set({ speedLimit: v })
  },

  subfolderName: '',
  setSubfolderName: (v) => set({ subfolderName: v }),

  resetForNewUrl: () =>
    set({
      selectedVariantUrl: null,
      selectedQuality: '',
      selectedYtdlpFormatId: null,
    }),
}))

export function useAvailableVideoQualities(): { height: number; fps: number }[] | null {
  const analyzeResult = useUIStore((s) => s.analyzeResult)

  return useMemo(() => {
    if (analyzeResult?.kind !== 'ytdlp') return null

    const formats = analyzeResult.formats
    const unique = new Map<number, number>()

    for (const f of formats) {
      if (!f.height || f.height < 140) continue
      const standardHeight = f.height
      const fps = f.fps || Math.round(Number((f.description?.match(/(\d+)fps/) || [])[1])) || 0
      if (!unique.has(standardHeight) || fps > (unique.get(standardHeight) || 0)) {
        unique.set(standardHeight, fps)
      }
    }

    return Array.from(unique.entries())
      .map(([height, fps]) => ({ height, fps }))
      .sort((a, b) => b.height - a.height)
  }, [analyzeResult])
}
