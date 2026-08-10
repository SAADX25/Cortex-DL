import { create } from 'zustand'
import { useMemo } from 'react'
import { useUIStore } from './useUIStore'

/**
 * "Add Download" form slice — everything the AddDownloadTab form reads/writes
 * while the user is configuring a download (trim range, format, quality,
 * subtitles, speed limit, destination sub-folder, etc).
 *
 * Split out of the old `useAppController` god hook so leaf components (the
 * format picker, the quality picker, the trimmer toggle, ...) can subscribe
 * to just the one field they render instead of receiving the entire form as
 * a prop bag that changes identity on every keystroke.
 */
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

  selectedSubtitleLanguage: string
  setSelectedSubtitleLanguage: (v: string) => void

  /**
   * Currently write-only (reserved for a future resolution-based picker) —
   * kept as a real field for parity with the pre-refactor behavior rather
   * than silently dropping the setter that several UI handlers already call.
   */
  targetResolution: number | null
  setTargetResolution: (v: number | null) => void

  speedLimit: string
  setSpeedLimit: (v: string) => void

  subfolderName: string
  setSubfolderName: (v: string) => void

  /** Resets every per-analysis field back to its default (new URL / cleared input). */
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

  selectedSubtitleLanguage: '',
  setSelectedSubtitleLanguage: (v) => set({ selectedSubtitleLanguage: v }),

  targetResolution: null,
  setTargetResolution: (v) => set({ targetResolution: v }),

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
      targetResolution: null,
      selectedYtdlpFormatId: null,
      selectedSubtitleLanguage: '',
    }),
}))

/**
 * Height/fps buckets available for the currently analyzed yt-dlp source.
 * Cross-store derived value (depends on `useUIStore`'s `analyzeResult`), so
 * it lives as a selector hook rather than inside either store directly.
 */
export function useAvailableVideoQualities(): { height: number; fps: number }[] | null {
  const analyzeResult = useUIStore((s) => s.analyzeResult)

  return useMemo(() => {
    if (analyzeResult?.kind !== 'ytdlp') return null

    const normalizeHeight = (h: number) => {
      if (h >= 4320) return 4320
      if (h >= 2160 || h >= 2026) return 2160
      if (h >= 1440 || h >= 1350) return 1440
      if (h >= 1080 || h >= 1012) return 1080
      if (h >= 720 || h >= 676) return 720
      if (h >= 480 || h >= 450) return 480
      if (h >= 360 || h >= 338) return 360
      if (h >= 240 || h >= 224) return 240
      return 144
    }

    const formats = analyzeResult.formats
    const unique = new Map<number, number>()

    for (const f of formats) {
      if (!f.height || f.height < 140) continue
      const standardHeight = normalizeHeight(f.height)
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
