/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  useAppController — Central business-logic hook for the Cortex DL app.
 *
 *  Owns:
 *  ─ All IPC-facing side-effects (engines, credentials, auto-update, …)
 *  ─ All action handlers (analyze, download, batch, settings, …)
 *  ─ Local-only state that doesn't need to be shared (settings, modals, etc.)
 *
 *  Global UI state (activeTab, directory, batchItems, globalError, url,
 *  analyzeResult, analyzing, toast) is now in the Zustand `useUIStore` —
 *  components subscribe directly via selectors, eliminating prop drilling
 *  and unnecessary re-renders.
 *
 *  Returns a flat object consumed by App.tsx (the view layer).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { translations, Language } from '../translations'
import type { BatchItem } from '../components/AddDownloadTab'
import { initDownloadStore, useDownloadStore, getTasksSnapshot } from '../stores/downloadStore'
import { useUIStore } from '../stores/useUIStore'

// ─── Helpers (pure, no React) ────────────────────────────────────────────────

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

export function variantLabel(v: any, lang: Language): string {
  const res = v.resolution ? `${v.resolution.height}p` : null
  const bw = v.bandwidth ? `${Math.round(v.bandwidth / 1000)} kbps` : null
  if (res && bw) return `${res} • ${bw}`
  if (res) return res
  if (bw) return bw
  return translations[lang].quality_placeholder
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAppController() {
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

  // ── Local state (not shared with other components directly) ──
  const [_filename, setFilename] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [selectedVariantUrl, setSelectedVariantUrl] = useState<string | null>(null)
  const [targetFormat, setTargetFormat] = useState<TargetFormat>('mp4')
  const [isAudioMode, setIsAudioMode] = useState(false)
  const [selectedQuality, setSelectedQuality] = useState<string>('')
  const [selectedYtdlpFormatId, setSelectedYtdlpFormatId] = useState<string | null>(null)
  const [_targetResolution, setTargetResolution] = useState<number | null>(null)
  const [speedLimit, setSpeedLimit] = useState<string>(() => localStorage.getItem('cortex-speed-limit') || 'auto')
  const [subfolderName, setSubfolderName] = useState('')
  const [cookieBrowser] = useState<string>(() => localStorage.getItem('cortex-cookie-browser') || 'none')
  const [cookieFile] = useState<string | null>(() => localStorage.getItem('cortex-cookie-file'))
  const [username, setUsername] = useState<string>('')
  const [password, setPassword] = useState<string>('')

  // ── UI chrome state (local) ──
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem('language') as Language) || 'en')

  // ── Settings / engine state ──
  const [notificationsEnabled] = useState(true)
  const [concurrentDownloads] = useState(3)
  const [useInAppPlayer, setUseInAppPlayer] = useState<boolean>(() => localStorage.getItem('cortex-inapp-player') !== 'false')
  const [totalDownloadedBytes, setTotalDownloadedBytes] = useState<number>(() => parseInt(localStorage.getItem('cortex-total-bytes') || '0', 10))
  const [enginesStatus, setEnginesStatus] = useState<{ ytdlp: boolean; ffmpeg: boolean; jsRuntime: boolean; jsRuntimeName: string }>({
    ytdlp: true, ffmpeg: true, jsRuntime: true, jsRuntimeName: 'None'
  })
  const [updateStatus, setUpdateStatus] = useState<{ status: string; percent?: number; error?: string } | null>(null)
  const [engineVersion, setEngineVersion] = useState<string>('...')
  const [engineUpdateStatus, setEngineUpdateStatus] = useState<{ updating: boolean; message?: string; success?: boolean } | null>(null)

  // ── Media player state ──
  const [mediaPlayerFile, setMediaPlayerFile] = useState<{ filePath: string; title?: string } | null>(null)

  // ── Comments state ──
  const [isCommentsDownloading, setIsCommentsDownloading] = useState(false)
  const [commentsSuccessPath, setCommentsSuccessPath] = useState<string | null>(null)
  const [commentsProgress, setCommentsProgress] = useState<{ current: number; total: number } | null>(null)

  // ── Confirm modal state ──
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    onConfirm: () => void
    type?: 'danger' | 'warning' | 'info'
  }>({
    isOpen: false, title: '', message: '',
    confirmText: 'Confirm', cancelText: 'Cancel',
    onConfirm: () => {}, type: 'danger'
  })

  // ── Thumbnail port (for SmartImage) ──
  const [thumbPort, setThumbPort] = useState(3345)

  const t = translations[lang]

  // ─── Derived / Computed ─────────────────────────────────────────────────────

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

  // ─── Side Effects ───────────────────────────────────────────────────────────

  // Resolve dynamic media server port
  useEffect(() => {
    const w = window as any
    if (w.cortexDl?.getMediaPort) {
      w.cortexDl.getMediaPort().then((port: number) => setThumbPort(port)).catch(() => {})
    }
  }, [])

  // Engine status polling
  useEffect(() => {
    const check = async () => {
      try { setEnginesStatus(await window.cortexDl.checkEngines()) }
      catch (err) { console.error('Failed to check engines:', err) }
    }
    check()
    const timer = setInterval(check, 10000)
    return () => clearInterval(timer)
  }, [])

  // Engine version
  useEffect(() => {
    ;(async () => {
      try { setEngineVersion(await window.cortexDl.getEngineVersion()) }
      catch { setEngineVersion('Error') }
    })()
  }, [])

  // Language direction
  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    localStorage.setItem('language', lang)
  }, [lang])

  // Comments IPC listeners
  useEffect(() => {
    let cleanupStarted: (() => void) | undefined
    let cleanupProgress: (() => void) | undefined

    if (window.cortexDl.onCommentsExtractionStarted) {
      cleanupStarted = window.cortexDl.onCommentsExtractionStarted(() => {
        setCommentsProgress(null)
        setCommentsSuccessPath(null)
        setIsCommentsDownloading(true)
      })
    }

    if (window.cortexDl.onCommentsProgress) {
      cleanupProgress = window.cortexDl.onCommentsProgress((current, total) => {
        setCommentsProgress({ current, total })
      })
    }

    return () => {
      cleanupStarted && cleanupStarted()
      cleanupProgress && cleanupProgress()
    }
  }, [])

  // Auto-update listener
  useEffect(() => {
    return window.cortexDl.onUpdateStatus((status) => {
      setUpdateStatus(status)
      if (status.status === 'not-available' || status.status === 'error') {
        setTimeout(() => setUpdateStatus(null), 5000)
      }
    })
  }, [])

  // localStorage syncs (directory is now handled by the store's setDirectory)
  useEffect(() => { localStorage.setItem('cortex-cookie-browser', cookieBrowser) }, [cookieBrowser])
  useEffect(() => {
    if (cookieFile) localStorage.setItem('cortex-cookie-file', cookieFile)
    else localStorage.removeItem('cortex-cookie-file')
  }, [cookieFile])
  useEffect(() => { localStorage.setItem('cortex-notifications', String(notificationsEnabled)) }, [notificationsEnabled])
  useEffect(() => { localStorage.setItem('cortex-concurrent', String(concurrentDownloads)) }, [concurrentDownloads])
  useEffect(() => {
    const timer = setTimeout(() => localStorage.setItem('cortex-total-bytes', String(totalDownloadedBytes)), 1000)
    return () => clearTimeout(timer)
  }, [totalDownloadedBytes])

  // Secure credentials
  useEffect(() => {
    ;(async () => {
      try {
        const [savedUser, savedPass] = await Promise.all([
          window.cortexDl.getSecureData('cortex-username'),
          window.cortexDl.getSecureData('cortex-password')
        ])
        if (savedUser) setUsername(savedUser)
        if (savedPass) setPassword(savedPass)
        localStorage.removeItem('cortex-username')
        localStorage.removeItem('cortex-password')
      } catch (err) { console.error('Failed to load secure credentials', err) }
    })()
  }, [])
  useEffect(() => { if (username !== '') window.cortexDl.saveSecureData('cortex-username', username) }, [username])
  useEffect(() => { if (password !== '') window.cortexDl.saveSecureData('cortex-password', password) }, [password])

  // Download store init
  useEffect(() => {
    const disposeStore = initDownloadStore()
    const statsDispose = window.cortexDl.onStatsUpdated(({ addedBytes }) => {
      setTotalDownloadedBytes(current => current + addedBytes)
    })
    return () => { disposeStore(); statsDispose() }
  }, [])

  // Reset analysis on URL change
  useEffect(() => {
    setAnalyzeResult(null)
    setSelectedVariantUrl(null)
    setTargetResolution(null)
    setSelectedYtdlpFormatId(null)
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
  }, [])

  // ─── Action Handlers ────────────────────────────────────────────────────────

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
      const newTitle = res && (res as any).title ? (res as any).title : undefined
      const newThumb = res && (res as any).thumbnail ? (res as any).thumbnail : undefined
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

    try {
      const items = [...currentBatchItems]
      let index = 0

      const runNext = async (): Promise<void> => {
        while (index < items.length) {
          const i = index++
          const item = items[i]
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
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => runNext()))

      showToast(`${count} items added to Queue!`)
      setBatchItems([])
      resetInputState()
      setActiveTab('downloads')
    } catch (err) {
      console.error('Batch add failed:', err)
      setGlobalError(err instanceof Error ? err.message : 'Failed to add batch')
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

  // ── Settings actions ──

  const onCheckForUpdates = async () => {
    setUpdateStatus({ status: 'checking' })
    try { await window.cortexDl.checkForUpdates() }
    catch (err) { console.error(err); setUpdateStatus({ status: 'error' }) }
  }

  const onUpdateEngine = async () => {
    setEngineUpdateStatus({ updating: true, message: 'Downloading...' })
    try {
      const result = await window.cortexDl.updateEngine()
      if (result.success) {
        setEngineUpdateStatus({ updating: false, success: true, message: result.message })
        if (result.version) setEngineVersion(result.version)
        else setEngineVersion(await window.cortexDl.getEngineVersion())
        setTimeout(() => setEngineUpdateStatus(null), 5000)
      } else {
        setEngineUpdateStatus({ updating: false, success: false, message: result.message })
        setTimeout(() => setEngineUpdateStatus(null), 5000)
      }
    } catch (err) {
      console.error('Engine update error:', err)
      setEngineUpdateStatus({ updating: false, success: false, message: 'Update failed' })
      setTimeout(() => setEngineUpdateStatus(null), 5000)
    }
  }

  const onResetStats = () => {
    setModalConfig({
      isOpen: true,
      title: t.reset_stats,
      message: t.confirm_reset_stats,
      confirmText: t.modal_confirm,
      cancelText: t.modal_cancel,
      type: 'warning',
      onConfirm: () => {
        setTotalDownloadedBytes(0)
        localStorage.setItem('cortex-total-bytes', '0')
        setModalConfig(prev => ({ ...prev, isOpen: false }))
      }
    })
  }

  const onRestartAndInstall = async () => {
    try { await window.cortexDl.restartApp() }
    catch (err) { console.error(err) }
  }

  const onUninstall = () => {
    setModalConfig({
      isOpen: true,
      title: t.settings_modal_title,
      message: t.settings_modal_desc,
      confirmText: t.settings_confirm_uninstall,
      cancelText: t.settings_cancel,
      type: 'danger',
      onConfirm: async () => {
        try { await window.cortexDl.uninstallApp() }
        catch { await window.cortexDl.openExternal('ms-settings:appsfeatures') }
        setModalConfig(prev => ({ ...prev, isOpen: false }))
      }
    })
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

  const closeModal = () => setModalConfig(prev => ({ ...prev, isOpen: false }))

  // ─── Return API ─────────────────────────────────────────────────────────────

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

    // UI chrome
    lang, setLang,
    activeDownloadCount,

    // Settings / engine
    useInAppPlayer, setUseInAppPlayer,
    totalDownloadedBytes,
    enginesStatus,
    updateStatus,
    engineVersion,
    engineUpdateStatus,

    // Media player
    mediaPlayerFile, setMediaPlayerFile,

    // Comments
    isCommentsDownloading, setIsCommentsDownloading,
    commentsSuccessPath, setCommentsSuccessPath,
    commentsProgress,

    // Modal
    modalConfig, closeModal,

    // Thumbnail port
    thumbPort,

    // Actions
    onPickFolder,
    onPasteAndAnalyze,
    handleAnalyzeUrlDirectly,
    onAddToList,
    onStartBatchDownload,
    onDownloadNow,
    onCheckForUpdates,
    onUpdateEngine,
    onResetStats,
    onRestartAndInstall,
    onUninstall,
    onDelete,
    onOpenFile,
    onOpenFolder,
    onOpenExternal,
  }
}
