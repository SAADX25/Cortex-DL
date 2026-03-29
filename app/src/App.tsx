import { useState, useEffect, useCallback } from 'react'
import { X, Youtube, Facebook, Instagram, Clapperboard, ClipboardPaste, RefreshCw, AlertTriangle, ShieldAlert, FolderPlus } from 'lucide-react'
import './App.css'
import { translations, Language } from './translations'
import ConfirmModal from './ConfirmModal'
import MediaPlayerModal from './MediaPlayerModal'
import DownloadList from './components/DownloadList'
import CustomDropdown from './components/CustomDropdown'
import AnimatedSegmentedControl from './components/AnimatedSegmentedControl'
import { initDownloadStore, useDownloadStore, getTasksSnapshot } from './stores/downloadStore'
import { formatBytes } from './hooks/useDownloadCardVM'

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

type BatchItem = {
  id: string
  url: string
  title?: string
  thumbnail?: string
  format: TargetFormat
  loading?: boolean
  quality?: string | null
}

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
  const [username] = useState<string>(() => localStorage.getItem('cortex-username') || '')
  const [password] = useState<string>(() => localStorage.getItem('cortex-password') || '')
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
  const [engineUpdateStatus, setEngineUpdateStatus] = useState<{ updating: boolean; message?: string; success?: boolean } | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const t = translations[lang]

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

  useEffect(() => {
    localStorage.setItem('cortex-username', username)
  }, [username])

  useEffect(() => {
    localStorage.setItem('cortex-password', password)
  }, [password])

  useEffect(() => {
    localStorage.setItem('cortex-notifications', String(notificationsEnabled))
  }, [notificationsEnabled])

  useEffect(() => {
    localStorage.setItem('cortex-concurrent', String(concurrentDownloads))
  }, [concurrentDownloads])

  useEffect(() => {
    localStorage.setItem('cortex-total-bytes', String(totalDownloadedBytes))
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
      for (const item of batchItems) {
        const finalUrl = item.url
        const engine: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp' = isYtdlpUrl(finalUrl) ? 'ytdlp' : 'auto'
        await window.cortexDl.addDownload({
          url: finalUrl,
          directory: resolvedDirectory,
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
      <aside className="sidebar">
        <div className="brand flex items-center justify-center">
          <h1 className="cortex-logo-text">Cortex DL</h1>
        </div>
        
        <nav className="nav-menu">
          <button className={`nav-item ${activeTab === 'add' ? 'active' : ''}`} onClick={() => setActiveTab('add')}>
            <span className="nav-icon">➕</span>
            <span className="nav-text">{t.nav_add}</span>
          </button>
          <button className={`nav-item ${activeTab === 'downloads' ? 'active' : ''}`} onClick={() => setActiveTab('downloads')}>
            <span className="nav-icon">📥</span>
            <span className="nav-text">{t.nav_downloads}</span>
            {activeDownloadCount > 0 && (
              <span className="nav-badge">{activeDownloadCount}</span>
            )}
          </button>
          <button className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
            <span className="nav-icon">⚙️</span>
            <span className="nav-text">{t.nav_settings}</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className={`status-dot ${enginesStatus.ytdlp && enginesStatus.ffmpeg && enginesStatus.jsRuntime ? 'online' : 'offline'}`}></div>
          <div className="status-details">
            <div className="status-main">
              {enginesStatus.ytdlp && enginesStatus.ffmpeg && enginesStatus.jsRuntime 
                ? t.engine_ready 
                : (!enginesStatus.ytdlp ? t.engine_missing_ytdlp : !enginesStatus.ffmpeg ? t.engine_missing_ffmpeg : 'JS Runtime Missing')}
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {/* Transient toast */}
        {toastMsg && (
          <div style={{ position: 'fixed', right: 20, top: 20, background: 'rgba(15,23,42,0.95)', color: '#fff', padding: '10px 14px', borderRadius: 10, boxShadow: '0 8px 30px rgba(2,6,23,0.6)', zIndex: 1000 }}>
            {toastMsg}
          </div>
        )}
        {activeTab === 'add' && (
          <div className="tab-content fade-in centered-layout flex flex-col h-full">
            <header className="content-header centered-header">
              <h1 className="gradient-text">{t.add_title}</h1>
              <p className="muted">{t.add_subtitle}</p>
            </header>

            <section className="minimal-panel">
              <div className="input-group">

                {/* STEP 1: URL Input */}
                <div className="w-full">
                  <div className="hero-input-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      className="hero-input"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && url.trim() && !analyzing) handleAnalyzeUrlDirectly(url) }}
                      placeholder={batchItems.length >= MAX_BATCH_ITEMS ? `Batch full (${MAX_BATCH_ITEMS}/${MAX_BATCH_ITEMS}). Start download to clear.` : t.url_placeholder}
                      dir="auto"
                    />
                    {url && (
                      <button className="hero-clear-btn" onClick={() => setUrl('')}>
                        <X size={20} />
                      </button>
                    )}
                    <button
                      className="hero-action-btn"
                      onClick={url.trim().length === 0 ? onPasteAndAnalyze : () => handleAnalyzeUrlDirectly(url)}
                      disabled={analyzing}
                    >
                      {analyzing ? (
                        <div className="spinner-sm"></div>
                      ) : url.trim().length === 0 ? (
                        <>
                          <ClipboardPaste size={20} />
                          <span>{t.paste_and_go}</span>
                        </>
                      ) : (
                        <>
                          <span>🔍</span>
                          <span>Analyze</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* STEP 2: Global Settings Row */}
                <div className="modern-chips-grid flex flex-row justify-between items-center w-full">
                  {/* Left: Media Type */}
                  <div className="chip-group flex flex-row items-center gap-2">
                    <button
                      className={`modern-chip transition-all duration-300 ease-in-out transform hover:scale-105 hover:-translate-y-1 ${!isAudioMode ? 'chip-active-blue hover:shadow-[0_8px_30px_rgba(34,211,238,0.4)]' : ''}`}
                      onClick={() => {
                        setIsAudioMode(false)
                        setTargetFormat('mp4')
                      }}
                    >
                      {t.btn_video}
                    </button>
                    <button
                      className={`modern-chip transition-all duration-300 ease-in-out transform hover:scale-105 hover:-translate-y-1 ${isAudioMode ? 'chip-active-purple hover:shadow-[0_8px_30px_rgba(168,85,247,0.4)]' : ''}`}
                      onClick={() => {
                        setIsAudioMode(true)
                        setTargetFormat('mp3')
                      }}
                    >
                      {t.btn_audio}
                    </button>
                  </div>

                  {/* Right: Download Settings */}
                  <div className="chip-group flex flex-row items-center gap-3">
                    <div className="cortex-pill cursor-pointer" onClick={onPickFolder}>
                      <span className="text-lg">📁</span>
                      <span className="text-white text-sm font-medium">
                        {directory ? directory.split(/[\\/]/).pop() : t.save_to}
                      </span>
                    </div>

                    <div className="cortex-pill">
                      <FolderPlus size={16} className="text-cyan-400" />
                      <input
                        className="cortex-pill-input"
                        placeholder={t.new_folder_placeholder}
                        value={subfolderName}
                        onChange={(e) => setSubfolderName(e.target.value)}
                      />
                    </div>

                    <select
                      className="speed-select h-[42px] rounded-full"
                      value={speedLimit}
                      onChange={(e) => {
                        setSpeedLimit(e.target.value)
                        localStorage.setItem('cortex-speed-limit', e.target.value)
                      }}
                      title="Download Speed Limit"
                    >
                      <option value="auto">⚡ {t.speed_auto}</option>
                      <option value="1M">1 MB/s</option>
                      <option value="10M">10 MB/s</option>
                      <option value="50M">50 MB/s</option>
                      <option value="100M">100 MB/s</option>
                    </select>
                  </div>
                </div>

                {/* STEP 3: Preview + Config + Actions — revealed when analysis is complete */}
                {analyzeResult && (
                  <div className="fade-in">
                    {/* Preview Card */}
                    {analyzeResult.kind === 'playlist' ? (
                      <div className="playlist-preview">
                        <div className="playlist-header">
                          <h3>🎬 {t.playlist_title}: {analyzeResult.title}</h3>
                          <span className="badge">{analyzeResult.items.length} {t.items_count}</span>
                        </div>
                        <div className="playlist-items">
                          {analyzeResult.items.slice(0, 10).map((item) => (
                            <div key={item.id} className="playlist-item">
                              {item.thumbnail && <SmartImage src={item.thumbnail} alt="" />}
                              <span title={item.title}>{item.title}</span>
                            </div>
                          ))}
                          {analyzeResult.items.length > 10 && (
                            <div className="playlist-more">+ {analyzeResult.items.length - 10} more...</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="video-preview-large">
                        {analyzeResult.kind === 'ytdlp' && analyzeResult.thumbnail && (
                          <SmartImage src={analyzeResult.thumbnail} alt="thumb" className="preview-thumb-large" />
                        )}
                        <div className="preview-info-large">
                          <div className="preview-title-large">
                            {analyzeResult.kind === 'ytdlp' ? analyzeResult.title : 'HLS Stream'}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Advanced Settings */}
                    <div className="advanced-options">
                      <div className="format-quality-row">
                        {/* Format Pills */}
                        <div className="option-box">
                          <label className="option-label">{t.format_label || 'File Format'}</label>
                          <div className="flex flex-wrap gap-2" style={{ padding: 6 }}>
                            <AnimatedSegmentedControl
                              wrap={true}
                              options={!isAudioMode
                                ? [
                                    { value: 'mp4',  label: 'MP4'  },
                                    { value: 'mkv',  label: 'MKV'  },
                                    { value: 'avi',  label: 'AVI'  },
                                    { value: 'mov',  label: 'MOV'  },
                                    { value: 'webm', label: 'WEBM' },
                                    { value: 'ogv',  label: 'OGV'  },
                                    { value: 'm4v',  label: 'M4V'  },
                                  ]
                                : [
                                    { value: 'mp3',  label: 'MP3'  },
                                    { value: 'wav',  label: 'WAV'  },
                                    { value: 'm4a',  label: 'M4A'  },
                                    { value: 'ogg',  label: 'OGG'  },
                                    { value: 'flac', label: 'FLAC' },
                                    { value: 'aac',  label: 'AAC'  },
                                    { value: 'opus', label: 'OPUS' },
                                    { value: 'wma',  label: 'WMA'  },
                                  ]}
                              value={targetFormat}
                              onChange={(v) => setTargetFormat(v as TargetFormat)}
                              size="md"
                            />
                          </div>
                        </div>

                        {/* Quality Dropdown (Video only) */}
                        {!isAudioMode && (
                          <div className="option-box">
                            <label className="option-label">{t.quality_label}</label>
                            <select
                              className="quality-select"
                              value={selectedQuality}
                              onChange={(e) => {
                                setSelectedQuality(e.target.value)
                                setSelectedYtdlpFormatId(e.target.value || null)
                                setTargetResolution(null)
                              }}
                            >
                              <option value="">{t.quality_best || 'Best Auto'}</option>
                              <option value="2160p">{t.quality_4k || '4K'}</option>
                              <option value="1440p">{t.quality_2k || '2K'}</option>
                              <option value="1080p">{t.quality_1080p || '1080p'}</option>
                              <option value="720p">{t.quality_720p || '720p'}</option>
                            </select>
                          </div>
                        )}
                      </div>

                      {/* Smart Time Trimming */}
                      <div className="option-box time-trim-box">
                        <label className="option-label">✂️ Smart Time Trim (optional)</label>
                        <div className="time-trim-row">
                          <div className="time-trim-field">
                            <span className="time-trim-hint">Start</span>
                            <input
                              className="time-trim-input"
                              type="text"
                              placeholder="HH:MM:SS"
                              value={startTime}
                              onChange={(e) => setStartTime(e.target.value)}
                            />
                          </div>
                          <span className="time-trim-sep">→</span>
                          <div className="time-trim-field">
                            <span className="time-trim-hint">End</span>
                            <input
                              className="time-trim-input"
                              type="text"
                              placeholder="HH:MM:SS"
                              value={endTime}
                              onChange={(e) => setEndTime(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      {/* HLS variant selector */}
                      {analyzeResult.kind === 'hls-master' && (
                        <div className="option-box">
                          <label className="option-label">{t.quality_label}</label>
                          <select
                            className="quality-select"
                            value={selectedVariantUrl ?? ''}
                            onChange={(e) => setSelectedVariantUrl(e.target.value)}
                          >
                            {analyzeResult.variants.map((v) => (
                              <option value={v.url} key={v.url}>{variantLabel(v, lang)}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Two Action Buttons */}
                    <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                      <button
                        className="download-main-btn-large"
                        style={{ flex: 1 }}
                        onClick={onDownloadNow}
                      >
                        🚀 Download Now
                      </button>
                      <button
                        style={{ flex: 1, padding: '14px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#d1d5db', fontWeight: 600, fontSize: 15, cursor: batchItems.length >= MAX_BATCH_ITEMS ? 'not-allowed' : 'pointer', opacity: batchItems.length >= MAX_BATCH_ITEMS ? 0.4 : 1, transition: 'background 0.2s' }}
                        onClick={onAddToList}
                        disabled={batchItems.length >= MAX_BATCH_ITEMS}
                        onMouseEnter={(e) => { if (batchItems.length < MAX_BATCH_ITEMS) e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                      >
                        ➕ Add to Batch List
                      </button>
                    </div>
                  </div>
                )}

                {/* STEP 4: Batch list */}
                <div className="flex-1 overflow-y-auto pr-2">
                  {batchItems.length > 0 && (
                    <div className="batch-list fade-in" style={{ marginTop: 12, borderRadius: 8, background: '#0b1220', padding: 8 }}>
                      {batchItems.map((item, idx) => (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', overflow: 'hidden' }}>
                              {item.thumbnail ? (
                              <SmartImage src={item.thumbnail} alt="thumb" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: 6 }} />
                            ) : item.loading ? (
                              <div style={{ width: 56, height: 32, borderRadius: 6, background: '#081026', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>⏳</div>
                            ) : (
                              <div style={{ width: 56, height: 32, borderRadius: 6, background: '#081026', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>{item.format === 'mp3' ? '🎵' : '🎬'}</div>
                            )}
                            <div style={{ color: '#d1d5db', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }} title={item.title || item.url}>
                              {item.title || (item.loading ? 'Loading...' : item.url)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ minWidth: 92, display: 'flex', alignItems: 'center' }}>
                              <CustomDropdown
                                value={item.format}
                                onChange={(v) => setBatchItems(prev => prev.map(b => b.id === item.id ? { ...b, format: v as TargetFormat } : b))}
                                groups={[
                                  { label: 'Video', options: [ { value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WEBM' }, { value: 'mkv', label: 'MKV' } ] },
                                  { label: 'Audio', options: [ { value: 'mp3', label: 'MP3' }, { value: 'm4a', label: 'M4A' }, { value: 'wav', label: 'WAV' }, { value: 'flac', label: 'FLAC' } ] }
                                ]}
                              />
                            </div>
                            <button className="batch-remove-btn" onClick={() => setBatchItems(prev => prev.filter((_, i) => i !== idx))}>✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {globalError ? <div className="global-error-banner">{globalError}</div> : null}
            </section>

            {/* Bottom Anchor: Start Batch Download */}
            <div className="w-full mt-auto pt-4 flex-none">
              <div className="w-full max-w-full mx-auto px-2">
                <button
                  className="download-main-btn-large fade-in w-full"
                  onClick={onStartBatchDownload}
                  disabled={batchItems.length === 0}
                >
                  Start Batch Download ({batchItems.length} / {MAX_BATCH_ITEMS} items)
                </button>
              </div>
            </div>

            <div className="quick-access-bar-minimal">
              <div className="quick-access-buttons">
                <button className="brand-icon-btn youtube" onClick={() => onOpenExternal('https://www.youtube.com')} title="YouTube">
                  <Youtube size={20} />
                </button>
                <button className="brand-icon-btn ytmusic" onClick={() => onOpenExternal('https://music.youtube.com/')} title="YouTube Music">
                  <YouTubeMusicIcon size={22} />
                </button>
                <button className="brand-icon-btn facebook" onClick={() => onOpenExternal('https://www.facebook.com')} title="Facebook">
                  <Facebook size={20} />
                </button>
                <button className="brand-icon-btn instagram" onClick={() => onOpenExternal('https://www.instagram.com')} title="Instagram">
                  <Instagram size={20} />
                </button>
                <button className="brand-icon-btn x" onClick={() => onOpenExternal('https://x.com')} title="X">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </button>
                <button className="brand-icon-btn tiktok" onClick={() => onOpenExternal('https://www.tiktok.com')} title="TikTok">
                  <Clapperboard size={20} />
                </button>
              </div>
            </div>

          </div>
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
          <div className="tab-content fade-in centered-layout">
            <header className="content-header centered-header">
              <h1 className="gradient-text">{t.settings_title}</h1>
              <p className="muted">{t.settings_subtitle}</p>
            </header>

            <section className="minimal-panel" style={{ gap: '3rem' }}>
              
              {/* Hero Stats */}
              <div className="settings-hero-stats">
                 <div className="hero-stat-value gradient-text-large">
                   {formatBytes(totalDownloadedBytes)}
                 </div>
                 <div className="hero-stat-label">
                   {t.total_downloaded}
                   <button className="reset-icon-btn" onClick={onResetStats} title={t.reset_stats}>
                      <RefreshCw size={14} />
                   </button>
                 </div>
              </div>

              <div className="settings-section">
                <h3 className="section-header">{t.settings_general}</h3>
                
                <div className="minimal-row">
                  <div className="row-info">
                    <span className="row-title">{t.language_label}</span>
                  </div>
                  <div className="row-control">
                    <div className="custom-select-wrapper">
                      <select 
                        className="custom-select" 
                        value={lang} 
                        onChange={(e) => setLang(e.target.value as Language)}
                      >
                        <option value="en" className="bg-[#1e293b] text-white">English</option>
                        <option value="ar" className="bg-[#1e293b] text-white">العربية</option>
                      </select>
                      <div className="custom-select-icon">
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="minimal-row">
                  <div className="row-info">
                    <span className="row-title">{t.use_inapp_player}</span>
                    <span className="row-subtitle">{t.use_inapp_player_desc}</span>
                  </div>
                  <div className="row-control">
                    <div 
                      className={`toggle-switch ${useInAppPlayer ? 'active' : ''}`}
                      onClick={() => {
                        const newValue = !useInAppPlayer
                        setUseInAppPlayer(newValue)
                        localStorage.setItem('cortex-inapp-player', String(newValue))
                      }}
                    >
                      <div className="toggle-switch-thumb" />
                    </div>
                  </div>
                </div>

                <div className="minimal-row">
                   <div className="row-info">
                     <span className="row-title">{t.check_for_updates}</span>
                     <span className="row-subtitle">
                        {updateStatus?.status === 'checking' && t.checking_updates}
                        {updateStatus?.status === 'available' && t.update_available}
                        {updateStatus?.status === 'progress' && `${t.update_available} ${Math.round(updateStatus.percent || 0)}%`}
                        {updateStatus?.status === 'not-available' && t.update_not_available}
                        {updateStatus?.status === 'error' && t.update_error}
                        {!updateStatus && `${t.settings_current_version}v${__APP_VERSION__}`}
                     </span>
                   </div>
                   <div className="row-control">
                      {updateStatus?.status === 'downloaded' ? (
                        <button className="btn-ghost-success" onClick={onRestartAndInstall}>
                          {t.update_downloaded}
                        </button>
                      ) : (
                        <button 
                          className="btn-ghost-primary" 
                          onClick={onCheckForUpdates}
                          disabled={updateStatus?.status === 'checking' || updateStatus?.status === 'available' || updateStatus?.status === 'progress'}
                        >
                          <RefreshCw size={16} className={updateStatus?.status === 'checking' ? 'spin' : ''} />
                          <span>{t.check_for_updates}</span>
                        </button>
                      )}
                   </div>
                </div>

                <div className="minimal-row">
                   <div className="row-info">
                     <span className="row-title">Engine (yt-dlp)</span>
                     <span className="row-subtitle">
                        {engineUpdateStatus?.updating && engineUpdateStatus.message}
                        {engineUpdateStatus?.success === true && <span className="text-green-400">{engineUpdateStatus.message}</span>}
                        {engineUpdateStatus?.success === false && <span className="text-red-400">{engineUpdateStatus.message}</span>}
                        {!engineUpdateStatus && engineVersion}
                     </span>
                   </div>
                   <div className="row-control">
                      <button 
                        className="btn-ghost-primary" 
                        onClick={onUpdateEngine}
                        disabled={engineUpdateStatus?.updating}
                      >
                        <RefreshCw size={16} className={engineUpdateStatus?.updating ? 'spin' : ''} />
                        <span>Update Engine</span>
                      </button>
                   </div>
                </div>
              </div>

              <div className="settings-section">
                <h3 className="section-header">{t.settings_about}</h3>
                <div className="about-minimal">
                  <p className="about-row"><strong>Cortex DL</strong> v{__APP_VERSION__}</p>
                  <p className="about-row">{t.settings_developed_by} SAADX25</p>
                  <p className="about-row muted">{t.settings_powered_by} yt-dlp & FFmpeg</p>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="settings-section danger-zone">
                 <h3 className="section-header danger-text">
                   <AlertTriangle size={18} />
                   {t.settings_danger_zone}
                 </h3>
                 <div className="minimal-row danger-row">
                    <div className="row-info">
                       <span className="row-title">{t.settings_uninstall_title}</span>
                       <span className="row-subtitle">{t.settings_uninstall_desc}</span>
                    </div>
                    <div className="row-control">
                       <button className="btn-danger-outline" onClick={onUninstall}>
                          <ShieldAlert size={16} />
                          <span>{t.settings_uninstall_btn}</span>
                       </button>
                    </div>
                 </div>
              </div>

            </section>
          </div>
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
    </div>
  )
}

export default App
