/**
 *  useSettingsController — Settings, engines, credentials, and preferences.
 *
 *  Owns:
 *  ─ Language selection and direction
 *  ─ Engine status polling, version, and updates
 *  ─ App auto-update listener
 *  ─ Secure credentials (username/password)
 *  ─ Cookie state (browser, file)
 *  ─ In-app player preference
 *  ─ Download stats tracking (totalDownloadedBytes)
 *  ─ localStorage syncs for all settings
 *  ─ Actions: update engine, check updates, reset stats, uninstall
 */
import { useState, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { translations } from '../translations'
import type { Language } from '../translations'
import type { ModalConfig } from './types'

// 
export interface SettingsControllerDeps {
  setModalConfig: Dispatch<SetStateAction<ModalConfig>>
}

// 
export function useSettingsController({ setModalConfig }: SettingsControllerDeps) {
  // ── Language ──
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem('language') as Language) || 'en')
  const t = translations[lang]

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

  // ── Cookie state ──
  const [cookieBrowser] = useState<string>(() => localStorage.getItem('cortex-cookie-browser') || 'none')
  const [cookieFile] = useState<string | null>(() => localStorage.getItem('cortex-cookie-file'))

  // ── Credentials ──
  const [username, setUsername] = useState<string>('')
  const [password, setPassword] = useState<string>('')

  // 
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
    (async () => {
      try { setEngineVersion(await window.cortexDl.getEngineVersion()) }
      catch { setEngineVersion('Error') }
    })()
  }, [])

  // Language direction
  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    localStorage.setItem('language', lang)
  }, [lang])

  // Auto-update listener
  useEffect(() => {
    return window.cortexDl.onUpdateStatus((status) => {
      setUpdateStatus(status)
      if (status.status === 'not-available' || status.status === 'error') {
        setTimeout(() => setUpdateStatus(null), 5000)
      }
    })
  }, [])

  // localStorage syncs
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
    (async () => {
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

  // Stats listener (totalDownloadedBytes)
  useEffect(() => {
    const statsDispose = window.cortexDl.onStatsUpdated(({ addedBytes }) => {
      setTotalDownloadedBytes(current => current + addedBytes)
    })
    return () => { statsDispose() }
  }, [])

  // 
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

  // 
  return {
    // Language
    lang, setLang, t,

    // Settings state
    useInAppPlayer, setUseInAppPlayer,
    totalDownloadedBytes,
    enginesStatus,
    updateStatus,
    engineVersion,
    engineUpdateStatus,

    // Auth (consumed by download controller via composition shell)
    cookieBrowser,
    cookieFile,
    username,
    password,

    // Actions
    onCheckForUpdates,
    onUpdateEngine,
    onResetStats,
    onRestartAndInstall,
    onUninstall,
  }
}
