/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  useAppController — Composition shell.
 *
 *  Composes useDownloadController, useSettingsController, and
 *  useCommentsController into a single flat API consumed by App.tsx.
 *
 *  Owns only cross-cutting concerns:
 *  ─ Confirm modal state (shared by downloads + settings)
 *  ─ Thumbnail server port (for SmartImage)
 *
 *  The returned object has the same shape as the original monolithic hook,
 *  preserving full backward compatibility with App.tsx.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useState, useEffect } from 'react'
import { translations } from '../translations'
import type { Language } from '../translations'
import type { ModalConfig } from './types'
import { useDownloadController } from './useDownloadController'
import { useSettingsController } from './useSettingsController'
import { useCommentsController } from './useCommentsController'

// ─── Re‑export pure helpers consumed by App.tsx ──────────────────────────────

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
  // ── Shared: Confirm modal (used by both downloads and settings) ──
  const [modalConfig, setModalConfig] = useState<ModalConfig>({
    isOpen: false, title: '', message: '',
    confirmText: 'Confirm', cancelText: 'Cancel',
    onConfirm: () => {}, type: 'danger'
  })
  const closeModal = () => setModalConfig(prev => ({ ...prev, isOpen: false }))

  // ── Shared: Thumbnail port (for SmartImage) ──
  const [thumbPort, setThumbPort] = useState(3345)
  useEffect(() => {
    if (window.cortexDl?.getMediaPort) {
      window.cortexDl.getMediaPort().then((port) => setThumbPort(port)).catch(() => {})
    }
  }, [])

  // ── Domain hooks ──
  const settings = useSettingsController({ setModalConfig })

  const downloads = useDownloadController({
    cookieBrowser: settings.cookieBrowser,
    cookieFile: settings.cookieFile,
    username: settings.username,
    password: settings.password,
    useInAppPlayer: settings.useInAppPlayer,
    setModalConfig,
    t: settings.t,
  })

  const comments = useCommentsController()

  // ─── Return flat API (same shape as the original) ─────────────────────────

  return {
    // Constants
    MAX_BATCH_ITEMS: downloads.MAX_BATCH_ITEMS,

    // From Zustand store (components can also subscribe directly)
    url: downloads.url, setUrl: downloads.setUrl,
    directory: downloads.directory,
    globalError: downloads.globalError, setGlobalError: downloads.setGlobalError,
    batchItems: downloads.batchItems, setBatchItems: downloads.setBatchItems,
    activeTab: downloads.activeTab, setActiveTab: downloads.setActiveTab,
    toastMsg: downloads.toastMsg, showToast: downloads.showToast,
    analyzeResult: downloads.analyzeResult,
    analyzing: downloads.analyzing,

    // Local state (downloads)
    startTime: downloads.startTime, setStartTime: downloads.setStartTime,
    endTime: downloads.endTime, setEndTime: downloads.setEndTime,
    selectedVariantUrl: downloads.selectedVariantUrl, setSelectedVariantUrl: downloads.setSelectedVariantUrl,
    targetFormat: downloads.targetFormat, setTargetFormat: downloads.setTargetFormat,
    isAudioMode: downloads.isAudioMode, setIsAudioMode: downloads.setIsAudioMode,
    selectedQuality: downloads.selectedQuality, setSelectedQuality: downloads.setSelectedQuality,
    selectedYtdlpFormatId: downloads.selectedYtdlpFormatId, setSelectedYtdlpFormatId: downloads.setSelectedYtdlpFormatId,
    setTargetResolution: downloads.setTargetResolution,
    speedLimit: downloads.speedLimit, setSpeedLimit: downloads.setSpeedLimit,
    subfolderName: downloads.subfolderName, setSubfolderName: downloads.setSubfolderName,
    availableVideoQualities: downloads.availableVideoQualities,

    // UI chrome
    lang: settings.lang, setLang: settings.setLang,
    activeDownloadCount: downloads.activeDownloadCount,

    // Settings / engine
    useInAppPlayer: settings.useInAppPlayer, setUseInAppPlayer: settings.setUseInAppPlayer,
    totalDownloadedBytes: settings.totalDownloadedBytes,
    enginesStatus: settings.enginesStatus,
    updateStatus: settings.updateStatus,
    engineVersion: settings.engineVersion,
    engineUpdateStatus: settings.engineUpdateStatus,

    // Media player
    mediaPlayerFile: downloads.mediaPlayerFile, setMediaPlayerFile: downloads.setMediaPlayerFile,

    // Comments
    isCommentsDownloading: comments.isCommentsDownloading, setIsCommentsDownloading: comments.setIsCommentsDownloading,
    commentsSuccessPath: comments.commentsSuccessPath, setCommentsSuccessPath: comments.setCommentsSuccessPath,
    commentsProgress: comments.commentsProgress,

    // Modal
    modalConfig, closeModal,

    // Thumbnail port
    thumbPort,

    // Actions (downloads)
    onPickFolder: downloads.onPickFolder,
    onPasteAndAnalyze: downloads.onPasteAndAnalyze,
    handleAnalyzeUrlDirectly: downloads.handleAnalyzeUrlDirectly,
    onAddToList: downloads.onAddToList,
    onStartBatchDownload: downloads.onStartBatchDownload,
    onDownloadNow: downloads.onDownloadNow,
    onDelete: downloads.onDelete,
    onOpenFile: downloads.onOpenFile,
    onOpenFolder: downloads.onOpenFolder,
    onOpenExternal: downloads.onOpenExternal,

    // Actions (settings)
    onCheckForUpdates: settings.onCheckForUpdates,
    onUpdateEngine: settings.onUpdateEngine,
    onResetStats: settings.onResetStats,
    onRestartAndInstall: settings.onRestartAndInstall,
    onUninstall: settings.onUninstall,
  }
}
