import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, ClipboardPaste } from 'lucide-react'
import './App.css'
import { translations, Language } from './translations'
import ConfirmModal from './ConfirmModal'
import MediaPlayerModal from './MediaPlayerModal'
import DownloadList from './components/DownloadList'
import Sidebar from './components/Sidebar'
import SettingsTab from './components/SettingsTab'
import AddDownloadTab, { BatchItem } from './components/AddDownloadTab'
import { initDownloadStore, useDownloadStore, getTasksSnapshot } from './stores/downloadStore'
import React from 'react';
// formatBytes is now imported from hooks/useDownloadCardVM
// formatSpeed and statusLabel are no longer needed in App.tsx — they live in the ViewModel hook

function variantLabel(v: any, lang: Language): string {
  const res = v.resolution ? `${v.resolution.height}p` : null
  const bw = v.bandwidth ? `${Math.round(v.bandwidth / 1000)} kbps` : null
  if (res && bw) return `${res} • ${bw}`
  if (res) return res
  if (bw) return bw
  return translations[lang].quality_placeholder
}

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

export const YouTubeMusicIcon = ({ size = 22, ...props }: { size?: number } & any) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* White Hollow Ring */}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      {/* White Play Triangle */}
      <path d="M10.5 8.5 L15.5 12 L10.5 15.5 Z" fill="currentColor" />
    </svg>
  )
}

export const UrlInputBar = React.memo(({
  analyzing,
  batchCount,
  maxBatchItems,
  placeholderText,
  pasteAndGoText,
  onPasteAndAnalyze,
  onAnalyze,
  onClear,
  initialUrl = ''
}: {
  analyzing: boolean
  batchCount: number
  maxBatchItems: number
  placeholderText: string
  pasteAndGoText: string
  onPasteAndAnalyze: () => void
  onAnalyze: (url: string) => void
  onClear: () => void
  initialUrl: string
}) => {
  const [localUrl, setLocalUrl] = useState(initialUrl)

  useEffect(() => {
    setLocalUrl(initialUrl)
  }, [initialUrl])

  return (
    <div className="hero-input-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
      <input
        className="hero-input"
        value={localUrl}
        onChange={(e) => setLocalUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && localUrl.trim() && !analyzing) onAnalyze(localUrl) }}
        placeholder={batchCount >= maxBatchItems ? `Batch full (${maxBatchItems}/${maxBatchItems}). Start download to clear.` : placeholderText}
        dir="auto"
      />
      {localUrl && (
        <button className="hero-clear-btn" onClick={() => { setLocalUrl(''); onClear(); }}>
          <X size={20} />
        </button>
      )}
      <button
        className="hero-action-btn"
        onClick={localUrl.trim().length === 0 ? onPasteAndAnalyze : () => onAnalyze(localUrl)}
        disabled={analyzing}
      >
        {analyzing ? (
          <div className="spinner-sm"></div>
        ) : localUrl.trim().length === 0 ? (
          <>
            <ClipboardPaste size={20} />
            <span>{pasteAndGoText}</span>
          </>
        ) : (
          <>
            <span>🔍</span>
            <span>Analyze</span>
          </>
        )}
      </button>
    </div>
  )
})

function App() {
  const MAX_BATCH_ITEMS = 50
  const [url, setUrl] = useState('')
  const [directory, setDirectory] = useState<string | null>(() => localStorage.getItem('cortex-directory'))
  const [_filename, setFilename] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
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
  const [activeTab, setActiveTab] = useState<'add' | 'downloads' | 'settings'>('add')
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem('language') as Language) || 'en'
  })
  const [notificationsEnabled] = useState(true)
  const [concurrentDownloads] = useState(3)
  const [useInAppPlayer, setUseInAppPlayer] = useState<boolean>(() => {
    return localStorage.getItem('cortex-inapp-player') !== 'false'
  })
  const [mediaPlayerFile, setMediaPlayerFile] = useState<{ filePath: string; title?: string } | null>(null)
  const [totalDownloadedBytes, setTotalDownloadedBytes] = useState<number>(() => {
    return parseInt(localStorage.getItem('cortex-total-bytes') || '0', 10)
  })
  const [enginesStatus, setEnginesStatus] = useState<{ ytdlp: boolean; ffmpeg: boolean; jsRuntime: boolean; jsRuntimeName: string }>({ 
    ytdlp: true, 
    ffmpeg: true, 
    jsRuntime: true, 
    jsRuntimeName: 'None' 
  })
  const [updateStatus, setUpdateStatus] = useState<{ status: string; percent?: number; error?: string } | null>(null)
  const [engineVersion, setEngineVersion] = useState<string>('...')
  const [isCommentsDownloading, setIsCommentsDownloading] = useState(false)
  const [commentsSuccessPath, setCommentsSuccessPath] = useState<string | null>(null)
  const [commentsProgress, setCommentsProgress] = useState<{ current: number, total: number } | null>(null)
  const [engineUpdateStatus, setEngineUpdateStatus] = useState<{ updating: boolean; message?: string; success?: boolean } | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const t = translations[lang]

  const availableVideoQualities = useMemo(() => {
    if (analyzeResult?.kind !== 'ytdlp') return null;
    
    // Convert YouTube's weird "Premium" resolutions to standard ones
    const normalizeHeight = (h: number) => {
      if (h >= 4320) return 4320;
      if (h >= 2160 || h >= 2026) return 2160;
      if (h >= 1440 || h >= 1350) return 1440;
      if (h >= 1080 || h >= 1012) return 1080;
      if (h >= 720 || h >= 676) return 720;
      if (h >= 480 || h >= 450) return 480;
      if (h >= 360 || h >= 338) return 360;
      if (h >= 240 || h >= 224) return 240;
      return 144;
    };

    const formats = analyzeResult.formats;
    const unique = new Map<number, number>();
    
    for (const f of formats) {
      if (!f.height || f.height < 140) continue;
      
      const standardHeight = normalizeHeight(f.height);
      const fps = f.fps || Math.round(Number((f.description?.match(/(\d+)fps/) || [])[1])) || 0;
      
      if (!unique.has(standardHeight) || fps > (unique.get(standardHeight) || 0)) {
        unique.set(standardHeight, fps);
      }
    }
    
    return Array.from(unique.entries())
      .map(([height, fps]) => ({ height, fps }))
      .sort((a, b) => b.height - a.height);
  }, [analyzeResult]);

  const THUMB_FALLBACK_DATA_URI = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='90'><rect width='100%' height='100%' fill='%23081126'/><text x='50%' y='50%' font-size='12' fill='%239ca3af' dominant-baseline='middle' text-anchor='middle'>No image</text></svg>"

  function SmartImage({ src, alt, className, style, ...rest }: any) {
    const [imgSrc, setImgSrc] = useState<string | undefined>(src)
    useEffect(() => {
      let cancelled = false
      setImgSrc(src)
      if (src && /instagram|cdninstagram/i.test(src)) {
        ;(async () => {
          try {
            const dataUri = await (window as any).cortexDl.fetchThumbnail(src)
            if (!cancelled && dataUri) setImgSrc(dataUri)
          } catch (err) {
            // fall back to original src; onError will handle visuals
          }
        })()
      }
      return () => { cancelled = true }
    }, [src])

    return (
      // eslint-disable-next-line jsx-a11y/alt-text
      <img
        src={imgSrc || THUMB_FALLBACK_DATA_URI}
        alt={alt || ''}
        className={className}
        style={style}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(e: any) => { e.currentTarget.onerror = null; e.currentTarget.src = THUMB_FALLBACK_DATA_URI }}
        {...rest}
      />
    )
  }

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    onConfirm: () => void
    type?: 'danger' | 'warning' | 'info'
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    onConfirm: () => {},
    type: 'danger'
  })

  useEffect(() => {
    const check = async () => {
      try {
        const status = await window.cortexDl.checkEngines()
        setEnginesStatus(status)
      } catch (err) {
        console.error('Failed to check engines:', err)
      }
    }
    check()
    const timer = setInterval(check, 10000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const version = await window.cortexDl.getEngineVersion()
        setEngineVersion(version)
      } catch (err) {
        console.error('Failed to get engine version:', err)
        setEngineVersion('Error')
      }
    }
    fetchVersion()
  }, [])

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    localStorage.setItem('language', lang)
  }, [lang])

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

  // Listen for auto-update events
  useEffect(() => {
    return window.cortexDl.onUpdateStatus((status) => {
      setUpdateStatus(status)
      if (status.status === 'not-available' || status.status === 'error') {
        setTimeout(() => setUpdateStatus(null), 5000)
      }
    })
  }, [])

  useEffect(() => {
    if (directory) localStorage.setItem('cortex-directory', directory)
  }, [directory])

  useEffect(() => {
    localStorage.setItem('cortex-cookie-browser', cookieBrowser)
  }, [cookieBrowser])

  useEffect(() => {
    if (cookieFile) localStorage.setItem('cortex-cookie-file', cookieFile)
    else localStorage.removeItem('cortex-cookie-file')
  }, [cookieFile])

  // Initial load of secure credentials via IPC
  useEffect(() => {
    const loadCredentials = async () => {
      try {
        const [savedUser, savedPass] = await Promise.all([
          window.cortexDl.getSecureData('cortex-username'),
          window.cortexDl.getSecureData('cortex-password')
        ])
        if (savedUser) setUsername(savedUser)
        if (savedPass) setPassword(savedPass)
        
        // Remove legacy unencrypted data if present
        localStorage.removeItem('cortex-username')
        localStorage.removeItem('cortex-password')
      } catch (err) {
        console.error('Failed to load secure credentials', err)
      }
    }
    loadCredentials()
  }, [])

  useEffect(() => {
    if (username !== '') window.cortexDl.saveSecureData('cortex-username', username)
  }, [username])

  useEffect(() => {
    if (password !== '') window.cortexDl.saveSecureData('cortex-password', password)
  }, [password])

  useEffect(() => {
    localStorage.setItem('cortex-notifications', String(notificationsEnabled))
  }, [notificationsEnabled])

  useEffect(() => {
    localStorage.setItem('cortex-concurrent', String(concurrentDownloads))
  }, [concurrentDownloads])

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('cortex-total-bytes', String(totalDownloadedBytes))
    }, 1000)
    return () => clearTimeout(timer)
  }, [totalDownloadedBytes])

  // ── Download Store initialization (replaces old IPC listener spaghetti) ──
  useEffect(() => {
    const disposeStore = initDownloadStore()

    // Stats listener stays here (it writes to localStorage, not the store)
    const statsDispose = window.cortexDl.onStatsUpdated(({ addedBytes }) => {
      setTotalDownloadedBytes(current => current + addedBytes)
    })

    return () => {
      disposeStore()
      statsDispose()
    }
  }, [])

  // Derive the active download count from the store for the nav badge
  const activeDownloadCount = useDownloadStore(
    (s) => Array.from(s.tasks.values()).filter((t) => t.status === 'downloading').length
  )

  useEffect(() => {
    setAnalyzeResult(null)
    setSelectedVariantUrl(null)
    setTargetResolution(null)
    setSelectedYtdlpFormatId(null)
  }, [url])

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      
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

  const onCheckForUpdates = async () => {
    setUpdateStatus({ status: 'checking' })
    try {
      await window.cortexDl.checkForUpdates()
    } catch (err) {
      console.error(err)
      setUpdateStatus({ status: 'error' })
    }
  }

  const onUpdateEngine = async () => {
    setEngineUpdateStatus({ updating: true, message: 'Downloading...' })
    try {
      const result = await window.cortexDl.updateEngine()
      if (result.success) {
        setEngineUpdateStatus({ updating: false, success: true, message: result.message })
        // Refresh engine version
        if (result.version) {
          setEngineVersion(result.version)
        } else {
          const newVersion = await window.cortexDl.getEngineVersion()
          setEngineVersion(newVersion)
        }
        // Clear message after 5 seconds
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

  const onResetStats = async () => {
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
    try {
      await window.cortexDl.restartApp()
    } catch (err) {
      console.error(err)
    }
  }

  const onUninstall = async () => {
    setModalConfig({
      isOpen: true,
      title: t.settings_modal_title,
      message: t.settings_modal_desc,
      confirmText: t.settings_confirm_uninstall,
      cancelText: t.settings_cancel,
      type: 'danger',
      onConfirm: async () => {
        try {
          // New Robust Uninstall (Clean Sweep)
          await window.cortexDl.uninstallApp()
        } catch (err) {
          // Fallback just in case, though the main process handles fallbacks
          await window.cortexDl.openExternal('ms-settings:appsfeatures')
        }
        setModalConfig(prev => ({ ...prev, isOpen: false }))
      }
    })
  }

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

  async function onPasteAndAnalyze() {
    setGlobalError(null)
    try {
      const text = await navigator.clipboard.readText()
      if (text && text.trim().length > 0) {
        setUrl(text)
        // Immediately trigger analysis after a short delay to ensure state update
        setTimeout(() => {
          // We can't call onAnalyzeUrl directly because it uses the 'url' state which might be stale in this closure
          // But since we are setting state, we need to pass the text directly or use a ref.
          // Better approach: Call a modified analyze function that accepts a URL.
          handleAnalyzeUrlDirectly(text)
        }, 50)
      } else {
        setGlobalError(t.analyze_failed) // Reuse error or add specific "Clipboard empty" message
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

  // Note: `onAnalyzeUrl` and `onStartDownload` were removed — code uses
  // `handleAnalyzeUrlDirectly` and batch start helpers instead.

  // Helper to show a short toast message
  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2300)
  }

  // Add current URL to batch list and prepare UI for next input
  function onAddToList() {
    const trimmed = url.trim()
    if (!trimmed) return
    // Enforce batch UI limit
    if (batchItems.length >= MAX_BATCH_ITEMS) {
      showToast(`⚠️ Batch limit reached! Please process your current ${MAX_BATCH_ITEMS} items before adding more.`)
      return
    }
    // basic validation
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

    setBatchItems(prev => [...prev, item])
    if (!knownTitle) void fetchMetadataForBatchItem(id, trimmed)
    // reset input state so user can paste next link
    setUrl('')
    setAnalyzeResult(null)
    setSelectedVariantUrl(null)
    setFilename('')
    setStartTime('')
    setEndTime('')
  }

  async function fetchMetadataForBatchItem(id: string, urlToAnalyze: string) {
    try {
      const res = await window.cortexDl.analyzeUrl(urlToAnalyze, cookieBrowser)
      // derive sensible fields
      const newTitle = res && (res as any).title ? (res as any).title : undefined
      const newThumb = res && (res as any).thumbnail ? (res as any).thumbnail : undefined
      setBatchItems(prev => prev.map(b => b.id === id ? { ...b, title: newTitle ?? b.title ?? undefined, thumbnail: newThumb ?? b.thumbnail ?? undefined, loading: false } : b))
    } catch (err) {
      // mark as not loading and leave URL as title fallback
      setBatchItems(prev => prev.map(b => b.id === id ? { ...b, loading: false, title: b.title === 'Loading...' ? undefined : b.title } : b))
    }
  }

  async function onStartBatchDownload() {
    let resolvedDirectory = directory
    if (!resolvedDirectory) {
      resolvedDirectory = await onPickFolder()
      if (!resolvedDirectory) return
    }

    const count = batchItems.length
    if (count === 0) return

    try {
      // Unblock the UI thread by eagerly returning promises
      await Promise.all(batchItems.map(item => {
        const finalUrl = item.url
        const engine: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp' = isYtdlpUrl(finalUrl) ? 'ytdlp' : 'auto'
        return window.cortexDl.addDownload({
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
      }))

      showToast(`${count} items added to Queue!`)
      setBatchItems([])
      setUrl('')
      setAnalyzeResult(null)
      setSelectedVariantUrl(null)
      setFilename('')
      setStartTime('')
      setEndTime('')
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
    let resolvedDirectory = directory
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
      setUrl('')
      setAnalyzeResult(null)
      setSelectedVariantUrl(null)
      setFilename('')
      setStartTime('')
      setEndTime('')
      setActiveTab('downloads')
    } catch (err) {
      console.error('Download Now failed:', err)
      setGlobalError(err instanceof Error ? err.message : 'Failed to start download')
    }
  }

  // onPause, onResume, onCancel are now handled per-card in useDownloadCardVM

  const onDelete = useCallback((id: string, deleteFile: boolean) => {
    const task = getTasksSnapshot().get(id)
    if (!task) return

    setModalConfig({
      isOpen: true,
      title: deleteFile ? t.btn_delete : t.btn_remove,
      message: deleteFile 
        ? t.msg_delete_file_confirm
        : t.msg_remove_list_confirm,
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
    try {
      await window.cortexDl.openFolder(filePath)
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : t.open_folder_failed)
    }
  }

  const onOpenExternal = async (url: string) => {
    try {
      await window.cortexDl.openExternal(url)
    } catch (err) {
      console.error('Failed to open external URL:', err)
    }
  }

  // `canStart` was previously used for a single-download start button; it's
  // unused now because batch flow and analyzed-dependent buttons control UI.

  return (
    <div className="app-container" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Sidebar 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeDownloadCount={activeDownloadCount}
        enginesStatus={enginesStatus}
        lang={lang}
      />

      <main className="main-content">
        {/* Transient toast */}
        {toastMsg && (
          <div style={{ position: 'fixed', right: 20, top: 20, background: 'rgba(15,23,42,0.95)', color: '#fff', padding: '10px 14px', borderRadius: 10, boxShadow: '0 8px 30px rgba(2,6,23,0.6)', zIndex: 1000 }}>
            {toastMsg}
          </div>
        )}
        {activeTab === 'add' && (
          <AddDownloadTab 
            url={url} setUrl={setUrl}
            batchItems={batchItems} setBatchItems={setBatchItems}
            MAX_BATCH_ITEMS={MAX_BATCH_ITEMS}
            directory={directory}
            subfolderName={subfolderName} setSubfolderName={setSubfolderName}
            speedLimit={speedLimit} setSpeedLimit={setSpeedLimit}
            targetFormat={targetFormat} setTargetFormat={setTargetFormat}
            isAudioMode={isAudioMode} setIsAudioMode={setIsAudioMode}
            selectedQuality={selectedQuality} setSelectedQuality={setSelectedQuality}
            analyzeResult={analyzeResult}
            selectedVariantUrl={selectedVariantUrl} setSelectedVariantUrl={setSelectedVariantUrl}
            startTime={startTime} setStartTime={setStartTime}
            endTime={endTime} setEndTime={setEndTime}
            globalError={globalError}
            analyzing={analyzing}
            availableVideoQualities={availableVideoQualities}
            setSelectedYtdlpFormatId={setSelectedYtdlpFormatId}
            setTargetResolution={setTargetResolution}
            onPasteAndAnalyze={onPasteAndAnalyze}
            handleAnalyzeUrlDirectly={handleAnalyzeUrlDirectly}
            onPickFolder={onPickFolder}
            onDownloadNow={onDownloadNow}
            onAddToList={onAddToList}
            onStartBatchDownload={onStartBatchDownload}
            onOpenExternal={onOpenExternal}
            setCommentsSuccessPath={setCommentsSuccessPath}
            showToast={showToast}
            setIsCommentsDownloading={setIsCommentsDownloading}
            lang={lang}
            SmartImage={SmartImage}
            UrlInputBar={UrlInputBar}
            variantLabel={variantLabel}
            YouTubeMusicIcon={YouTubeMusicIcon}
          />
        )}

        {activeTab === 'downloads' && (
          <DownloadList
            lang={lang}
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder}
            onDelete={onDelete}
            onError={setGlobalError}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            lang={lang}
            setLang={setLang}
            totalDownloadedBytes={totalDownloadedBytes}
            onResetStats={onResetStats}
            useInAppPlayer={useInAppPlayer}
            setUseInAppPlayer={setUseInAppPlayer}
            updateStatus={updateStatus}
            onCheckForUpdates={onCheckForUpdates}
            onRestartAndInstall={onRestartAndInstall}
            engineUpdateStatus={engineUpdateStatus}
            engineVersion={engineVersion}
            onUpdateEngine={onUpdateEngine}
            onUninstall={onUninstall}
          />
        )}
      </main>
      
      <ConfirmModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        cancelText={modalConfig.cancelText}
        type={modalConfig.type}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
      />

      <MediaPlayerModal
        isOpen={!!mediaPlayerFile}
        filePath={mediaPlayerFile?.filePath || ''}
        title={mediaPlayerFile?.title}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        onClose={() => setMediaPlayerFile(null)}
      />

      {isCommentsDownloading && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal-container" style={{ width: '400px', padding: '32px', textAlign: 'center' }}>
            {!commentsSuccessPath ? (
              <>
                <div className="spinner-sm" style={{ margin: '0 auto 16px auto', borderTopColor: '#3b82f6', width: '36px', height: '36px', borderWidth: '3px' }}></div>
                <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600 }}>
                  {lang === 'ar' ? 'جاري تحميل ملف التعليقات...' : 'Downloading comments file...'}
                </h3>
                <p className="animate-pulse" style={{ marginTop: '12px', color: '#94a3b8', fontSize: '0.95rem', marginBottom: 0, animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}>
                  {lang === 'ar'
                    ? (commentsProgress ? `جاري استخراج التعليقات... ${commentsProgress.current} / ~${commentsProgress.total}` : 'جاري الاتصال...')
                    : (commentsProgress ? `Extracting comments... ${commentsProgress.current} / ~${commentsProgress.total}` : 'Connecting...')}
                </p>
              </>
            ) : (
              <>
                <div style={{ margin: '0 auto 16px auto', width: '48px', height: '48px', backgroundColor: 'rgba(34, 197, 94, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '24px' }}>
                  {lang === 'ar' ? 'تم تحميل التعليقات بنجاح!' : 'Comments downloaded successfully!'}
                </h3>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={() => {
                      if (commentsSuccessPath) {
                         window.cortexDl.openFile(commentsSuccessPath);
                      }
                      setIsCommentsDownloading(false);
                      setCommentsSuccessPath(null);
                    }}
                    style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: lang === 'ar' ? '0' : '6px', marginLeft: lang === 'ar' ? '6px' : '0' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    {lang === 'ar' ? 'فتح الملف' : 'Open File'}
                  </button>
                  <button 
                    className="btn" 
                    onClick={() => {
                      setIsCommentsDownloading(false);
                      setCommentsSuccessPath(null);
                    }}
                    style={{ padding: '8px 16px', fontSize: '0.9rem', backgroundColor: '#334155', color: '#f8fafc', border: '1px solid #475569' }}
                  >
                    {lang === 'ar' ? 'إغلاق' : 'Close'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
