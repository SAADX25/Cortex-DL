/**
 * useDownloadController — Download operations domain.
 *
 * Owns:
 * - URL analysis and variant selection
 * - Format/quality/speed settings for downloads
 * - Batch operations (add to list, start batch)
 * - Single download (analyze -> download now)
 * - Download store initialization
 * - Drag-and-drop URL handling
 * - File/folder operations (open, delete)
 * - Media player state
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Translations } from '../translations'
import type { BatchItem } from '../components/AddDownloadTab'
import { initDownloadStore, useDownloadStore, getTasksSnapshot } from '../stores/downloadStore'
import { useUIStore } from '../stores/useUIStore'
import type { ModalConfig } from './types'

// Helpers

function isYtdlpUrl(url: string): boolean {
  const lowUrl = url.toLowerCase()
  if (
    lowUrl.includes('youtube.com') ||
    lowUrl.includes('youtu.be') ||
    lowUrl.includes('facebook.com') ||
    lowUrl.includes('fb.watch') ||
    lowUrl.includes('instagram.com') ||
    lowUrl.includes('tiktok.com') ||
    lowUrl.includes('twitter.com') ||
    lowUrl.includes('x.com') ||
    lowUrl.includes('vimeo.com') ||
    lowUrl.includes('dailymotion.com')
  ) {
    return true
  }

  if (/\.(mp4|mp3|m4a|webm|mkv|avi|m3u8)(\?|#|$)/i.test(lowUrl)) {
    return false
  }
  return true
}

// Dependencies

export interface DownloadControllerDeps {
  cookieBrowser: string
  cookieFile: string | null
  username: string
  password: string
  useInAppPlayer: boolean
  setModalConfig: Dispatch<SetStateAction<ModalConfig>>
  t: Translations
}

// Hook

export function useDownloadController({
  cookieBrowser, cookieFile, username, password,
  useInAppPlayer, setModalConfig, t,
}: DownloadControllerDeps) {
  // ── Constants ──
  const MAX_BATCH_ITEMS = 50

  // ── Zustand UI store — read via selectors for fine-grained subscriptions ──
  const url = useUIStore((s) => s.url)
  const setUrl = useUIStore((s) => s.setUrl)
  const directory = useUIStore((s) => s.directory)
  const setDirectory = useUIStore((s) => s.setDirectory)
  const globalError = useUIStore((s) => s.globalError)
  const setGlobalError = useUIStore((s) => s.setGlobalError)
  const batchItems = useUIStore((s) => s.batchItems)
  const setBatchItems = useUIStore((s) => s.setBatchItems)
  const activeTab = useUIStore((s) => s.activeTab)
  const setActiveTab = useUIStore((s) => s.setActiveTab)
  const toastMsg = useUIStore((s) => s.toastMsg)
  const showToast = useUIStore((s) => s.showToast)
  const analyzeResult = useUIStore((s) => s.analyzeResult)
  const setAnalyzeResult = useUIStore((s) => s.setAnalyzeResult)
  const analyzing = useUIStore((s) => s.analyzing)
  const setAnalyzing = useUIStore((s) => s.setAnalyzing)

  // Local state
  const [, setFilename] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [selectedVariantUrl, setSelectedVariantUrl] = useState<string | null>(null)
  const [targetFormat, setTargetFormat] = useState<TargetFormat>('mp4')
  const [isAudioMode, setIsAudioMode] = useState(false)
  const [selectedQuality, setSelectedQuality] = useState<string>('')
  const [selectedYtdlpFormatId, setSelectedYtdlpFormatId] = useState<string | null>(null)
  const [, setTargetResolution] = useState<number | null>(null)
  const [speedLimit, setSpeedLimit] = useState<string>(() => localStorage.getItem('cortex-speed-limit') || 'auto')
  const [subfolderName, setSubfolderName] = useState('')

  // ── Media player state ──
  const [mediaPlayerFile, setMediaPlayerFile] = useState<{ filePath: string; title?: string } | null>(null)

  // Derived / Computed

  const availableVideoQualities = useMemo(() => {
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

  const activeDownloadCount = useDownloadStore(
    (s) => Array.from(s.tasks.values()).filter((t) => t.status === 'downloading').length
  )

  // Side Effects

  // Download store init
  useEffect(() => {
    const disposeStore = initDownloadStore()
    return () => { disposeStore() }
  }, [])

  // Reset analysis on URL change
  useEffect(() => {
    setAnalyzeResult(null)
    setSelectedVariantUrl(null)
    setTargetResolution(null)
    setSelectedYtdlpFormatId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  // Drag-and-drop URL
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }
    const handleDrop = (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation()
      const droppedText = e.dataTransfer?.getData('text') || e.dataTransfer?.getData('url')
      if (droppedText && droppedText.startsWith('http')) {
        setUrl(droppedText)
        setActiveTab('add')
      }
    }
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Action Handlers

  async function onPickFolder(): Promise<string | null> {
    setGlobalError(null)
    try {
      const picked = await window.cortexDl.selectFolder()
      if (picked) setDirectory(picked)
      return picked ?? null
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : t.folder_pick_failed)
      return null
    }
  }

  function resetInputState() {
    setUrl('')
    setAnalyzeResult(null)
    setSelectedVariantUrl(null)
    setFilename('')
    setStartTime('')
    setEndTime('')
  }

  async function onPasteAndAnalyze() {
    setGlobalError(null)
    try {
      const text = await navigator.clipboard.readText()
      if (text && text.trim().length > 0) {
        setUrl(text)
        setTimeout(() => handleAnalyzeUrlDirectly(text), 50)
      } else {
        setGlobalError(t.analyze_failed)
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err)
      setGlobalError(t.analyze_failed)
    }
  }

  async function handleAnalyzeUrlDirectly(inputUrl: string) {
    setGlobalError(null)
    setAnalyzing(true)
    setAnalyzeResult(null)
    setSelectedVariantUrl(null)
    try {
      const result = await window.cortexDl.analyzeUrl(inputUrl.trim(), cookieBrowser)
      setAnalyzeResult(result)
      if (result.kind === 'hls-media') setSelectedVariantUrl(result.url)
      if (result.kind === 'hls-master') setSelectedVariantUrl(result.variants[0]?.url ?? null)
      if (result.kind === 'ytdlp') {
        setFilename(result.title)
        setTargetResolution(null)
        setSelectedYtdlpFormatId(null)
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : t.analyze_failed)
    } finally {
      setAnalyzing(false)
    }
  }

  function onAddToList() {
    const trimmed = url.trim()
    if (!trimmed) return
    if (batchItems.length >= MAX_BATCH_ITEMS) {
      showToast(`⚠️ Batch limit reached! Please process your current ${MAX_BATCH_ITEMS} items before adding more.`)
      return
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setGlobalError('Invalid URL')
      setTimeout(() => setGlobalError(null), 2500)
      return
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const knownTitle = analyzeResult?.kind === 'ytdlp' ? analyzeResult.title
      : analyzeResult?.kind === 'playlist' ? analyzeResult.title
      : undefined
    const knownThumb = analyzeResult?.kind === 'ytdlp' ? analyzeResult.thumbnail : undefined
    const item: BatchItem = {
      id,
      url: trimmed,
      title: knownTitle || 'Loading...',
      thumbnail: knownThumb,
      loading: !knownTitle,
      format: targetFormat,
      quality: selectedYtdlpFormatId || selectedQuality || null,
    }

    setBatchItems((prev) => [...prev, item])
    if (!knownTitle) void fetchMetadataForBatchItem(id, trimmed)
    resetInputState()
  }

  async function fetchMetadataForBatchItem(id: string, urlToAnalyze: string) {
    try {
      const res = await window.cortexDl.analyzeUrl(urlToAnalyze, cookieBrowser)
      const newTitle = res && 'title' in res ? res.title : undefined
      const newThumb = res && 'thumbnail' in res ? (res as { thumbnail?: string }).thumbnail : undefined
      setBatchItems((prev) => prev.map(b => b.id === id ? { ...b, title: newTitle ?? b.title ?? undefined, thumbnail: newThumb ?? b.thumbnail ?? undefined, loading: false } : b))
    } catch {
      setBatchItems((prev) => prev.map(b => b.id === id ? { ...b, loading: false, title: b.title === 'Loading...' ? undefined : b.title } : b))
    }
  }

  async function onStartBatchDownload() {
    const currentDirectory = useUIStore.getState().directory
    let resolvedDirectory = currentDirectory
    if (!resolvedDirectory) {
      resolvedDirectory = await onPickFolder()
      if (!resolvedDirectory) return
    }

    const currentBatchItems = useUIStore.getState().batchItems
    const count = currentBatchItems.length
    if (count === 0) return

    const CONCURRENCY = 5

    // Reset all items to pending before starting
    setBatchItems((prev) => prev.map(b => ({ ...b, status: 'pending' as const, errorMessage: undefined })))

    const items = [...currentBatchItems]
    let index = 0
    let successCount = 0
    let failCount = 0

    const runNext = async (): Promise<void> => {
      while (index < items.length) {
        const i = index++
        const item = items[i]

        // Mark item as processing
        setBatchItems((prev) => prev.map(b => b.id === item.id ? { ...b, status: 'processing' } : b))

        try {
          const finalUrl = item.url
          const engine: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp' = isYtdlpUrl(finalUrl) ? 'ytdlp' : 'auto'
          await window.cortexDl.addDownload({
            url: finalUrl,
            directory: resolvedDirectory!,
            subfolderName: subfolderName.trim() || undefined,
            filename: undefined,
            engine,
            targetFormat: item.format,
            ytdlpFormatId: item.quality ? String(item.quality).replace('raw:', '') : undefined,
            title: item.title || undefined,
            thumbnail: item.thumbnail || undefined,
            cookieBrowser,
            cookieFile: cookieFile || undefined,
            username: username || undefined,
            password: password || undefined,
            speedLimit: speedLimit !== 'auto' ? speedLimit : undefined,
            startTime: startTime.trim() || undefined,
            endTime: endTime.trim() || undefined,
          })

          // Mark item as success
          setBatchItems((prev) => prev.map(b => b.id === item.id ? { ...b, status: 'success' } : b))
          successCount++
        } catch (err) {
          // Mark item as error — do NOT set globalError, let the batch continue
          const msg = err instanceof Error ? err.message : 'Download failed'
          setBatchItems((prev) => prev.map(b => b.id === item.id ? { ...b, status: 'error', errorMessage: msg } : b))
          failCount++
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => runNext()))

    // Remove successful items, keep only failed ones for retry
    setBatchItems((prev) => prev.filter(b => b.status !== 'success'))

    if (failCount === 0) {
      showToast(`✅ ${successCount} items added to Queue!`)
      resetInputState()
      setActiveTab('downloads')
    } else if (successCount > 0) {
      showToast(`⚠️ ${successCount} queued, ${failCount} failed — fix and retry`)
    } else {
      showToast(`❌ All ${failCount} items failed`)
    }
  }

  async function onDownloadNow() {
    if (!analyzeResult) return
    const trimmed = url.trim()
    if (!trimmed) return
    let resolvedDirectory = useUIStore.getState().directory
    if (!resolvedDirectory) {
      resolvedDirectory = await onPickFolder()
      if (!resolvedDirectory) return
    }
    try {
      let downloadUrl = trimmed
      if (analyzeResult.kind === 'hls-media') downloadUrl = analyzeResult.url
      else if (analyzeResult.kind === 'hls-master' && selectedVariantUrl) downloadUrl = selectedVariantUrl
      const engine: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp' = isYtdlpUrl(trimmed) ? 'ytdlp' : 'auto'
      const title = analyzeResult.kind === 'ytdlp' ? analyzeResult.title
        : analyzeResult.kind === 'playlist' ? analyzeResult.title
        : undefined
      const thumbnail = analyzeResult.kind === 'ytdlp' ? analyzeResult.thumbnail : undefined
      await window.cortexDl.addDownload({
        url: downloadUrl,
        directory: resolvedDirectory,
        subfolderName: subfolderName.trim() || undefined,
        filename: undefined,
        engine,
        targetFormat,
        ytdlpFormatId: selectedYtdlpFormatId || selectedQuality || undefined,
        title,
        thumbnail,
        cookieBrowser,
        cookieFile: cookieFile || undefined,
        username: username || undefined,
        password: password || undefined,
        speedLimit: speedLimit !== 'auto' ? speedLimit : undefined,
        startTime: startTime.trim() || undefined,
        endTime: endTime.trim() || undefined,
      })
      showToast('🚀 Download started!')
      resetInputState()
      setActiveTab('downloads')
    } catch (err) {
      console.error('Download Now failed:', err)
      setGlobalError(err instanceof Error ? err.message : 'Failed to start download')
    }
  }

  // ── Download-list actions ──

  const onDelete = useCallback((id: string, deleteFile: boolean) => {
    const task = getTasksSnapshot().get(id)
    if (!task) return

    setModalConfig({
      isOpen: true,
      title: deleteFile ? t.btn_delete : t.btn_remove,
      message: deleteFile ? t.msg_delete_file_confirm : t.msg_remove_list_confirm,
      confirmText: t.modal_confirm,
      cancelText: t.modal_cancel,
      type: deleteFile ? 'danger' : 'warning',
      onConfirm: async () => {
        try {
          await window.cortexDl.deleteDownload(id, deleteFile)
          useDownloadStore.getState().removeTask(id)
          setModalConfig(prev => ({ ...prev, isOpen: false }))
        } catch (err) {
          setGlobalError(err instanceof Error ? err.message : t.delete_failed)
          setModalConfig(prev => ({ ...prev, isOpen: false }))
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  async function onOpenFile(filePath: string, title?: string) {
    try {
      if (useInAppPlayer) {
        setMediaPlayerFile({ filePath, title })
      } else {
        await window.cortexDl.openFile(filePath)
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : t.open_file_failed)
    }
  }

  async function onOpenFolder(filePath: string) {
    try { await window.cortexDl.openFolder(filePath) }
    catch (err) { setGlobalError(err instanceof Error ? err.message : t.open_folder_failed) }
  }

  const onOpenExternal = async (url: string) => {
    try { await window.cortexDl.openExternal(url) }
    catch (err) { console.error('Failed to open external URL:', err) }
  }

  // Return API

  return {
    // Constants
    MAX_BATCH_ITEMS,

    // From Zustand store (components can also subscribe directly)
    url, setUrl,
    directory,
    globalError, setGlobalError,
    batchItems, setBatchItems,
    activeTab, setActiveTab,
    toastMsg, showToast,
    analyzeResult,
    analyzing,

    // Local state
    startTime, setStartTime,
    endTime, setEndTime,
    selectedVariantUrl, setSelectedVariantUrl,
    targetFormat, setTargetFormat,
    isAudioMode, setIsAudioMode,
    selectedQuality, setSelectedQuality,
    selectedYtdlpFormatId, setSelectedYtdlpFormatId,
    setTargetResolution,
    speedLimit, setSpeedLimit,
    subfolderName, setSubfolderName,
    availableVideoQualities,

    // Counts
    activeDownloadCount,

    // Media player
    mediaPlayerFile, setMediaPlayerFile,

    // Actions
    onPickFolder,
    onPasteAndAnalyze,
    handleAnalyzeUrlDirectly,
    onAddToList,
    onStartBatchDownload,
    onDownloadNow,
    onDelete,
    onOpenFile,
    onOpenFolder,
    onOpenExternal,
  }
}
