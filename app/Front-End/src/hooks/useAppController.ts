import { useState } from 'react'
import { translations } from '../translations'
import type { Language } from '../translations'
import type { ModalConfig } from './types'
import { useDownloadController } from './useDownloadController'
import { useSettingsController } from './useSettingsController'
import { useCommentsController } from './useCommentsController'

export function variantLabel(v: any, lang: Language): string {
  const res = v.resolution ? `${v.resolution.height}p` : null
  const bw = v.bandwidth ? `${Math.round(v.bandwidth / 1000)} kbps` : null
  if (res && bw) return `${res} • ${bw}`
  if (res) return res
  if (bw) return bw
  return translations[lang].quality_placeholder
}

export function useAppController() {
  
  const [modalConfig, setModalConfig] = useState<ModalConfig>({
    isOpen: false, title: '', message: '',
    confirmText: 'Confirm', cancelText: 'Cancel',
    onConfirm: () => {}, type: 'danger'
  })
  const closeModal = () => setModalConfig(prev => ({ ...prev, isOpen: false }))

  
  const settings = useSettingsController({ setModalConfig })

  const downloads = useDownloadController({
    username: settings.username,
    password: settings.password,
    useInAppPlayer: settings.useInAppPlayer,
    setModalConfig,
    t: settings.t,
  })

  const comments = useCommentsController()

  
  return {
    
    MAX_BATCH_ITEMS: downloads.MAX_BATCH_ITEMS,

    
    url: downloads.url, setUrl: downloads.setUrl,
    directory: downloads.directory,
    globalError: downloads.globalError, setGlobalError: downloads.setGlobalError,
    batchItems: downloads.batchItems, setBatchItems: downloads.setBatchItems,
    activeTab: downloads.activeTab, setActiveTab: downloads.setActiveTab,
    toastMsg: downloads.toastMsg, showToast: downloads.showToast,
    analyzeResult: downloads.analyzeResult,
    analyzing: downloads.analyzing,

    
    startTime: downloads.startTime, setStartTime: downloads.setStartTime,
    endTime: downloads.endTime, setEndTime: downloads.setEndTime,
    selectedVariantUrl: downloads.selectedVariantUrl, setSelectedVariantUrl: downloads.setSelectedVariantUrl,
    targetFormat: downloads.targetFormat, setTargetFormat: downloads.setTargetFormat,
    isAudioMode: downloads.isAudioMode, setIsAudioMode: downloads.setIsAudioMode,
    selectedQuality: downloads.selectedQuality, setSelectedQuality: downloads.setSelectedQuality,
    selectedYtdlpFormatId: downloads.selectedYtdlpFormatId, setSelectedYtdlpFormatId: downloads.setSelectedYtdlpFormatId,
    selectedSubtitleLanguage: downloads.selectedSubtitleLanguage, setSelectedSubtitleLanguage: downloads.setSelectedSubtitleLanguage,
    setTargetResolution: downloads.setTargetResolution,
    speedLimit: downloads.speedLimit, setSpeedLimit: downloads.setSpeedLimit,
    subfolderName: downloads.subfolderName, setSubfolderName: downloads.setSubfolderName,
    availableVideoQualities: downloads.availableVideoQualities,

    
    lang: settings.lang, setLang: settings.setLang,
    activeDownloadCount: downloads.activeDownloadCount,

    
    useInAppPlayer: settings.useInAppPlayer, setUseInAppPlayer: settings.setUseInAppPlayer,
    cookieFilePath: settings.cookieFilePath,
    cookieValidation: settings.cookieValidation,
    healthCheck: settings.healthCheck,
    healthChecking: settings.healthChecking,
    concurrentDownloads: settings.concurrentDownloads, setConcurrentDownloads: settings.setConcurrentDownloads,
    totalDownloadedBytes: settings.totalDownloadedBytes,
    updateStatus: settings.updateStatus,
    engineVersion: settings.engineVersion,
    engineUpdateStatus: settings.engineUpdateStatus,

    
    mediaPlayerFile: downloads.mediaPlayerFile, setMediaPlayerFile: downloads.setMediaPlayerFile,

    
    isCommentsDownloading: comments.isCommentsDownloading, setIsCommentsDownloading: comments.setIsCommentsDownloading,
    commentsSuccessPath: comments.commentsSuccessPath, setCommentsSuccessPath: comments.setCommentsSuccessPath,
    commentsProgress: comments.commentsProgress,

    
    modalConfig, closeModal,

    
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
    removeAnalyzedPlaylistVideo: downloads.removeAnalyzedPlaylistVideo,
    togglePlaylistItemSelected: downloads.togglePlaylistItemSelected,
    selectAllPlaylistItems: downloads.selectAllPlaylistItems,
    deselectAllPlaylistItems: downloads.deselectAllPlaylistItems,
    clearPlaylistItems: downloads.clearPlaylistItems,

    
    onCheckForUpdates: settings.onCheckForUpdates,
    onUpdateEngine: settings.onUpdateEngine,
    onSelectCookieFile: settings.onSelectCookieFile,
    onClearCookieFile: settings.onClearCookieFile,
    refreshHealth: settings.refreshHealth,
    onResetStats: settings.onResetStats,
    onRestartAndInstall: settings.onRestartAndInstall,
    onUninstall: settings.onUninstall,
  }
}
