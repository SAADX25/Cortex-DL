import { translations } from '../translations'
import { MAX_BATCH_ITEMS } from '../constants/limits'
import { isYtdlpUrl, normalizeIpcError, SUBTITLE_EMBED_FORMATS } from '../lib/downloadHelpers'
import { useUIStore } from '../stores/useUIStore'
import { useFormStore } from '../stores/useFormStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useDownloadStore, getTasksSnapshot, getActiveDownloadCount } from '../stores/downloadStore'
import type { BatchItem } from '../components/AddDownloadTab'

/**
 * Plain, dependency-free action functions for the download workflow — no
 * hooks involved. Every function reads the state it needs from the Zustand
 * stores at *call time* (`getState()`), so these exports are stable forever:
 * components can pass `onDeleteTask`, `onOpenFile`, etc. straight down as
 * props without ever breaking `React.memo` on the receiving end (the
 * previous `useAppController`/`useDownloadController` chain re-created most
 * of these as fresh closures on every render).
 */

function t() {
  return translations[useSettingsStore.getState().lang]
}

function resetInputState(): void {
  const ui = useUIStore.getState()
  const form = useFormStore.getState()
  ui.setUrl('')
  ui.setAnalyzeResult(null)
  form.setSelectedVariantUrl(null)
  form.setStartTime('')
  form.setEndTime('')
  form.setSelectedSubtitleLanguage('')
}

export async function onPickFolder(): Promise<string | null> {
  const ui = useUIStore.getState()
  ui.setGlobalError(null)
  try {
    const picked = await window.cortexDl.selectFolder()
    if (picked) ui.setDirectory(picked)
    return picked ?? null
  } catch (err) {
    ui.setGlobalError(normalizeIpcError(err, t().folder_pick_failed, t().youtube_auth_required))
    return null
  }
}

async function performAnalysis(urlToAnalyze: string): Promise<void> {
  const ui = useUIStore.getState()
  const form = useFormStore.getState()

  ui.setGlobalError(null)
  ui.setAnalyzing(true)
  ui.setAnalyzeResult(null)
  form.setSelectedVariantUrl(null)
  form.setSelectedSubtitleLanguage('')
  ui.setUrl(urlToAnalyze)

  try {
    const result = await window.cortexDl.analyzeUrl(urlToAnalyze.trim())

    if (result.kind === 'playlist') {
      result.items = result.items.map((item: any) => ({ ...item, selected: true }))
    }

    useUIStore.getState().setAnalyzeResult(result)
    if (result.kind === 'hls-media') form.setSelectedVariantUrl(result.url)
    if (result.kind === 'hls-master') form.setSelectedVariantUrl(result.variants[0]?.url ?? null)
    if (result.kind === 'ytdlp') {
      form.setTargetResolution(null)
      form.setSelectedYtdlpFormatId(null)
    }
  } catch (err) {
    ui.setGlobalError(normalizeIpcError(err, t().analyze_failed, t().youtube_auth_required))
  } finally {
    ui.setAnalyzing(false)
  }
}

export async function onPasteAndAnalyze(): Promise<void> {
  const ui = useUIStore.getState()
  ui.setGlobalError(null)
  try {
    const text = await navigator.clipboard.readText()
    if (text && text.trim().length > 0) {
      ui.setUrl(text)
      setTimeout(() => { void handleAnalyzeUrlDirectly(text) }, 50)
    } else {
      ui.setGlobalError(t().analyze_failed)
    }
  } catch (err) {
    console.error('Failed to read clipboard:', err)
    ui.setGlobalError(t().analyze_failed)
  }
}

export async function handleAnalyzeUrlDirectly(inputUrl: string): Promise<void> {
  try {
    const parsedUrl = new URL(inputUrl)
    if (parsedUrl.searchParams.has('v') && (parsedUrl.searchParams.has('list') || parsedUrl.searchParams.has('list_id'))) {
      useUIStore.getState().setModalConfig({
        isOpen: true,
        title: 'Playlist Detected',
        message: 'Do you want to download the entire playlist or just this single video?',
        confirmText: 'Entire Playlist',
        cancelText: 'Single Video',
        type: 'info',
        onConfirm: () => {
          useUIStore.getState().closeModal()
          void performAnalysis(inputUrl)
        },
        onCancel: () => {
          useUIStore.getState().closeModal()
          parsedUrl.searchParams.delete('list')
          parsedUrl.searchParams.delete('index')
          void performAnalysis(parsedUrl.toString())
        },
      })
      return
    }
  } catch {
    // Not a valid absolute URL — fall through and analyze it as-is.
  }

  await performAnalysis(inputUrl)
}

async function fetchMetadataForBatchItem(id: string, urlToAnalyze: string): Promise<void> {
  const ui = useUIStore.getState()
  try {
    const res = await window.cortexDl.analyzeUrl(urlToAnalyze)
    const newTitle = res && 'title' in res ? res.title : undefined
    const newThumb = res && 'thumbnail' in res ? (res as { thumbnail?: string }).thumbnail : undefined
    ui.setBatchItems((prev) => prev.map((b) => b.id === id ? { ...b, title: newTitle ?? b.title ?? undefined, thumbnail: newThumb ?? b.thumbnail ?? undefined, loading: false } : b))
  } catch {
    ui.setBatchItems((prev) => prev.map((b) => b.id === id ? { ...b, loading: false, title: b.title === 'Loading...' ? undefined : b.title } : b))
  }
}

export function onAddToList(): void {
  const ui = useUIStore.getState()
  const form = useFormStore.getState()
  const { analyzeResult, batchItems, url } = ui
  const { targetFormat, selectedYtdlpFormatId, selectedQuality, selectedSubtitleLanguage } = form

  if (analyzeResult?.kind === 'playlist') {
    const selectedItems = analyzeResult.items.filter((item: any) => item.selected)
    const remainingSlots = MAX_BATCH_ITEMS - batchItems.length
    if (remainingSlots <= 0) {
      ui.showToast(`⚠️ Batch limit reached! Please process your current ${MAX_BATCH_ITEMS} items before adding more.`)
      return
    }

    const itemsToAdd: BatchItem[] = selectedItems.slice(0, remainingSlots).map((pItem: any) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: pItem.url,
      title: pItem.title || 'Loading...',
      thumbnail: pItem.thumbnail,
      loading: false,
      format: targetFormat,
      quality: selectedYtdlpFormatId || selectedQuality || null,
    }))

    ui.setBatchItems((prev) => [...prev, ...itemsToAdd])

    if (selectedItems.length > remainingSlots) {
      ui.showToast(`⚠️ Added ${remainingSlots} items. Batch limit reached!`)
    }
    resetInputState()
    return
  }

  const trimmed = url.trim()
  if (!trimmed) return
  if (batchItems.length >= MAX_BATCH_ITEMS) {
    ui.showToast(`⚠️ Batch limit reached! Please process your current ${MAX_BATCH_ITEMS} items before adding more.`)
    return
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    ui.setGlobalError('Invalid URL')
    setTimeout(() => useUIStore.getState().setGlobalError(null), 2500)
    return
  }

  if (selectedSubtitleLanguage && !SUBTITLE_EMBED_FORMATS.has(targetFormat)) {
    ui.showToast('Subtitles can be embedded only in MP4, MKV, or WEBM videos.')
    return
  }

  const selectedSubtitleTrack = analyzeResult?.kind === 'ytdlp' && selectedSubtitleLanguage
    ? analyzeResult.subtitles?.find((track) => track.languageCode === selectedSubtitleLanguage)
    : undefined

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const knownTitle = analyzeResult?.kind === 'ytdlp' ? analyzeResult.title : undefined
  const knownThumb = analyzeResult?.kind === 'ytdlp' ? analyzeResult.thumbnail : undefined
  const item: BatchItem = {
    id,
    url: trimmed,
    title: knownTitle || 'Loading...',
    thumbnail: knownThumb,
    loading: !knownTitle,
    format: targetFormat,
    quality: selectedYtdlpFormatId || selectedQuality || null,
    subtitleLanguage: selectedSubtitleTrack?.languageCode,
    subtitleIsAutomatic: selectedSubtitleTrack?.isAutomatic,
  }

  ui.setBatchItems((prev) => [...prev, item])
  if (!knownTitle) void fetchMetadataForBatchItem(id, trimmed)
  resetInputState()
}

export async function onStartBatchDownload(): Promise<void> {
  const ui = useUIStore.getState()
  const form = useFormStore.getState()
  const settings = useSettingsStore.getState()

  let resolvedDirectory = ui.directory
  if (!resolvedDirectory) {
    resolvedDirectory = await onPickFolder()
    if (!resolvedDirectory) return
  }

  const currentBatchItems = useUIStore.getState().batchItems
  const count = currentBatchItems.length
  if (count === 0) return

  ui.setBatchItems((prev) => prev.map((b) => ({ ...b, status: 'processing' as const, errorMessage: undefined })))

  try {
    const inputs = currentBatchItems.map((item) => {
      const finalUrl = item.url
      const engine: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp' = isYtdlpUrl(finalUrl) ? 'ytdlp' : 'auto'
      return {
        url: finalUrl,
        directory: resolvedDirectory!,
        subfolderName: form.subfolderName.trim() || undefined,
        filename: undefined,
        engine,
        targetFormat: item.format,
        ytdlpFormatId: item.quality ? String(item.quality).replace('raw:', '') : undefined,
        subtitleLanguage: item.subtitleLanguage,
        subtitleIsAutomatic: item.subtitleIsAutomatic,
        title: item.title || undefined,
        thumbnail: item.thumbnail || undefined,
        username: settings.username || undefined,
        password: settings.password || undefined,
        speedLimit: form.speedLimit !== 'auto' ? form.speedLimit : undefined,
        startTime: form.startTime.trim() || undefined,
        endTime: form.endTime.trim() || undefined,
      }
    })

    const createdTasks = await window.cortexDl.addBatchDownloads(inputs)
    useDownloadStore.getState().addMultipleTasks(createdTasks)

    ui.setBatchItems([])
    ui.showToast(`✅ ${count} items added to Queue!`)
    resetInputState()
    ui.setActiveTab('downloads')
  } catch (err) {
    const msg = normalizeIpcError(err, t().download_start_failed, t().youtube_auth_required)
    ui.showToast(`❌ ${msg}`)
    ui.setBatchItems((prev) => prev.map((b) => ({ ...b, status: 'error', errorMessage: msg })))
  }
}

export async function onDownloadNow(): Promise<void> {
  const ui = useUIStore.getState()
  const form = useFormStore.getState()
  const settings = useSettingsStore.getState()
  const { analyzeResult } = ui
  if (!analyzeResult) return

  if (form.selectedSubtitleLanguage && !SUBTITLE_EMBED_FORMATS.has(form.targetFormat)) {
    ui.showToast('Subtitles can be embedded only in MP4, MKV, or WEBM videos.')
    return
  }

  let resolvedDirectory = ui.directory
  if (!resolvedDirectory) {
    resolvedDirectory = await onPickFolder()
    if (!resolvedDirectory) return
  }
  try {
    if (analyzeResult.kind === 'playlist') {
      const selectedItems = analyzeResult.items.filter((item: any) => item.selected)
      const remainingSlots = Math.max(0, MAX_BATCH_ITEMS - getActiveDownloadCount())
      const itemsToDownload = selectedItems.slice(0, remainingSlots)

      if (itemsToDownload.length === 0) {
        ui.showToast(selectedItems.length === 0 ? `⚠️ No items selected for download!` : `⚠️ Max concurrent downloads reached!`)
        return
      }

      const inputs = itemsToDownload.map((pItem: any) => ({
        url: pItem.url,
        directory: resolvedDirectory!,
        subfolderName: form.subfolderName.trim() || undefined,
        filename: undefined,
        engine: 'ytdlp' as const,
        targetFormat: form.targetFormat,
        ytdlpFormatId: form.selectedYtdlpFormatId || form.selectedQuality || undefined,
        title: pItem.title || undefined,
        thumbnail: pItem.thumbnail || undefined,
        username: settings.username || undefined,
        password: settings.password || undefined,
        speedLimit: form.speedLimit !== 'auto' ? form.speedLimit : undefined,
        startTime: form.startTime.trim() || undefined,
        endTime: form.endTime.trim() || undefined,
      }))

      const createdTasks = await window.cortexDl.addBatchDownloads(inputs)
      useDownloadStore.getState().addMultipleTasks(createdTasks)
      ui.showToast(`🚀 Started ${createdTasks.length} playlist downloads!`)
    } else {
      const trimmed = ui.url.trim()
      if (!trimmed) return
      const engine: 'auto' | 'direct' | 'ffmpeg' | 'ytdlp' = isYtdlpUrl(trimmed) ? 'ytdlp' : 'auto'

      let downloadUrl = trimmed
      if (analyzeResult.kind === 'hls-media') downloadUrl = analyzeResult.url
      else if (analyzeResult.kind === 'hls-master' && form.selectedVariantUrl) downloadUrl = form.selectedVariantUrl

      const selectedSubtitleTrack = analyzeResult.kind === 'ytdlp' && form.selectedSubtitleLanguage
        ? analyzeResult.subtitles?.find((track) => track.languageCode === form.selectedSubtitleLanguage)
        : undefined

      await window.cortexDl.addDownload({
        url: downloadUrl,
        directory: resolvedDirectory!,
        subfolderName: form.subfolderName.trim() || undefined,
        filename: undefined,
        engine,
        targetFormat: form.targetFormat,
        ytdlpFormatId: form.selectedYtdlpFormatId || form.selectedQuality || undefined,
        subtitleLanguage: selectedSubtitleTrack?.languageCode,
        subtitleIsAutomatic: selectedSubtitleTrack?.isAutomatic,
        title: analyzeResult.kind === 'ytdlp' ? analyzeResult.title : undefined,
        thumbnail: analyzeResult.kind === 'ytdlp' ? analyzeResult.thumbnail : undefined,
        username: settings.username || undefined,
        password: settings.password || undefined,
        speedLimit: form.speedLimit !== 'auto' ? form.speedLimit : undefined,
        startTime: form.startTime.trim() || undefined,
        endTime: form.endTime.trim() || undefined,
      })
      ui.showToast('🚀 Download started!')
    }

    resetInputState()
    ui.setActiveTab('downloads')
  } catch (err) {
    console.error('Download Now failed:', err)
    ui.setGlobalError(normalizeIpcError(err, t().download_start_failed, t().youtube_auth_required))
  }
}

export function onDelete(id: string, deleteFile: boolean): void {
  const task = getTasksSnapshot().get(id)
  if (!task) return
  const ui = useUIStore.getState()
  const translated = t()

  ui.setModalConfig({
    isOpen: true,
    title: deleteFile ? translated.btn_delete : translated.btn_remove,
    message: deleteFile ? translated.msg_delete_file_confirm : translated.msg_remove_list_confirm,
    confirmText: translated.modal_confirm,
    cancelText: translated.modal_cancel,
    type: deleteFile ? 'danger' : 'warning',
    onConfirm: async () => {
      try {
        await window.cortexDl.deleteDownload(id, deleteFile)
        useDownloadStore.getState().removeTask(id)
        useUIStore.getState().closeModal()
      } catch (err) {
        useUIStore.getState().setGlobalError(normalizeIpcError(err, translated.delete_failed, translated.youtube_auth_required))
        useUIStore.getState().closeModal()
      }
    },
  })
}

export async function onOpenFile(filePath: string, title?: string): Promise<void> {
  const ui = useUIStore.getState()
  try {
    if (useSettingsStore.getState().useInAppPlayer) {
      ui.setMediaPlayerFile({ filePath, title })
    } else {
      await window.cortexDl.openFile(filePath)
    }
  } catch (err) {
    ui.setGlobalError(normalizeIpcError(err, t().open_file_failed, t().youtube_auth_required))
  }
}

export async function onOpenFolder(filePath: string): Promise<void> {
  try {
    await window.cortexDl.openFolder(filePath)
  } catch (err) {
    useUIStore.getState().setGlobalError(normalizeIpcError(err, t().open_folder_failed, t().youtube_auth_required))
  }
}

export async function onOpenExternal(url: string): Promise<void> {
  try { await window.cortexDl.openExternal(url) }
  catch (err) { console.error('Failed to open external URL:', err) }
}

export function removeAnalyzedPlaylistVideo(index: number): void {
  const ui = useUIStore.getState()
  if (ui.analyzeResult?.kind === 'playlist') {
    ui.setAnalyzeResult({
      ...ui.analyzeResult,
      items: ui.analyzeResult.items.filter((_: any, i: number) => i !== index),
    })
  }
}

export function togglePlaylistItemSelected(index: number): void {
  const ui = useUIStore.getState()
  if (ui.analyzeResult?.kind === 'playlist') {
    ui.setAnalyzeResult({
      ...ui.analyzeResult,
      items: ui.analyzeResult.items.map((p: any, i: number) =>
        i === index ? { ...p, selected: !p.selected } : p
      ),
    })
  }
}

export function selectAllPlaylistItems(indicesToSelect?: number[]): void {
  const ui = useUIStore.getState()
  if (ui.analyzeResult?.kind === 'playlist') {
    ui.setAnalyzeResult({
      ...ui.analyzeResult,
      items: ui.analyzeResult.items.map((p: any, i: number) => {
        if (!indicesToSelect || indicesToSelect.includes(i)) {
          return { ...p, selected: true }
        }
        return p
      }),
    })
  }
}

export function deselectAllPlaylistItems(indicesToDeselect?: number[]): void {
  const ui = useUIStore.getState()
  if (ui.analyzeResult?.kind === 'playlist') {
    ui.setAnalyzeResult({
      ...ui.analyzeResult,
      items: ui.analyzeResult.items.map((p: any, i: number) => {
        if (!indicesToDeselect || indicesToDeselect.includes(i)) {
          return { ...p, selected: false }
        }
        return p
      }),
    })
  }
}

export function clearPlaylistItems(): void {
  const ui = useUIStore.getState()
  if (ui.analyzeResult?.kind === 'playlist') {
    ui.setAnalyzeResult({ ...ui.analyzeResult, items: [] })
  }
}
