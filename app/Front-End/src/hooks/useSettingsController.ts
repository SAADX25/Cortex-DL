import { useState, useEffect, useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { translations } from '../translations'
import type { Language } from '../translations'
import type { ModalConfig } from './types'

export interface SettingsControllerDeps {
  setModalConfig: Dispatch<SetStateAction<ModalConfig>>
}

export function useSettingsController({ setModalConfig }: SettingsControllerDeps) {
  
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem('language') as Language) || 'en')
  const t = translations[lang]

  
  const [notificationsEnabled] = useState(true)
  const [concurrentDownloads, setConcurrentDownloads] = useState(3)
  const [useInAppPlayer, setUseInAppPlayer] = useState<boolean>(() => localStorage.getItem('cortex-inapp-player') !== 'false')
  const [totalDownloadedBytes, setTotalDownloadedBytes] = useState<number>(() => parseInt(localStorage.getItem('cortex-total-bytes') || '0', 10))
  const [updateStatus, setUpdateStatus] = useState<{ status: string; percent?: number; error?: string } | null>(null)
  const [engineVersion, setEngineVersion] = useState<string>('...')
  const [engineUpdateStatus, setEngineUpdateStatus] = useState<{ updating: boolean; message?: string; success?: boolean } | null>(null)
  const [cookieFilePath, setCookieFilePath] = useState<string | null>(null)
  const [cookieValidation, setCookieValidation] = useState<CookieValidationResult | null>(null)
  const [healthCheck, setHealthCheck] = useState<AppHealthCheck | null>(null)
  const [healthChecking, setHealthChecking] = useState(true)

  
  const [username, setUsername] = useState<string>('')
  const [password, setPassword] = useState<string>('')

  const refreshHealth = useCallback(async () => {
    setHealthChecking(true)
    try {
      const [health, jsRuntime] = await Promise.all([
        window.cortexDl.getHealthCheck(),
        window.cortexDl.checkJsRuntime(),
      ])
      setHealthCheck({ ...health, jsRuntime })
      setEngineVersion(health.ytDlp.version)
      if (health.cookies.filePath || health.cookies.code !== 'missing') {
        setCookieValidation(health.cookies)
      }
    } catch (err) {
      console.error('Health check failed:', err)
      setHealthCheck(null)
    } finally {
      setHealthChecking(false)
    }
  }, [])

  
  useEffect(() => {
    window.cortexDl.getConcurrency().then((val) => {
      if ([3, 5, 10].includes(val)) setConcurrentDownloads(val)
    }).catch(() => {})
  }, [])
  useEffect(() => {
    void refreshHealth()
  }, [refreshHealth])

  
  useEffect(() => {
    (async () => {
      try { setEngineVersion(await window.cortexDl.getEngineVersion()) }
      catch { setEngineVersion('Error') }
    })()
  }, [])

  
  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    localStorage.setItem('language', lang)
  }, [lang])

  
  useEffect(() => {
    return window.cortexDl.onUpdateStatus((status) => {
      setUpdateStatus(status)
      if (status.status === 'not-available' || status.status === 'error') {
        setTimeout(() => setUpdateStatus(null), 5000)
      }
    })
  }, [])

  
  useEffect(() => { localStorage.setItem('cortex-notifications', String(notificationsEnabled)) }, [notificationsEnabled])
  useEffect(() => {
    localStorage.setItem('cortex-concurrent', String(concurrentDownloads))
    window.cortexDl.setConcurrency(concurrentDownloads).catch(() => {})
  }, [concurrentDownloads])
  useEffect(() => {
    const timer = setTimeout(() => localStorage.setItem('cortex-total-bytes', String(totalDownloadedBytes)), 1000)
    return () => clearTimeout(timer)
  }, [totalDownloadedBytes])

  useEffect(() => {
    if (window.cortexDl?.getCookieFile) {
      window.cortexDl.getCookieFile().then((path) => {
        if (path) setCookieFilePath(path)
      }).catch(() => {})
    }
  }, [])

  
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

  
  useEffect(() => {
    const statsDispose = window.cortexDl.onStatsUpdated(({ addedBytes }) => {
      setTotalDownloadedBytes(current => current + addedBytes)
    })
    return () => { statsDispose() }
  }, [])

  
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
        await refreshHealth()
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

  const onSelectCookieFile = async () => {
    try {
      const filePath = await window.cortexDl.selectCookieFile()
      if (filePath) {
        const validation = await window.cortexDl.setCookieFile(filePath)
        setCookieValidation(validation)
        if (validation.valid && validation.filePath) {
          setCookieFilePath(validation.filePath)
          await refreshHealth()
        }
      }
    } catch (err) {
      console.error('Failed to select cookie file:', err)
    }
  }

  const onClearCookieFile = async () => {
    try {
      const validation = await window.cortexDl.setCookieFile(null)
      setCookieFilePath(null)
      setCookieValidation(validation)
      await refreshHealth()
    } catch (err) {
      console.error('Failed to clear cookie file:', err)
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

  
  return {
    
    lang, setLang, t,

    
    useInAppPlayer, setUseInAppPlayer,
    cookieFilePath,
    cookieValidation,
    healthCheck,
    healthChecking,
    concurrentDownloads, setConcurrentDownloads,
    totalDownloadedBytes,
    updateStatus,
    engineVersion,
    engineUpdateStatus,

    
    username,
    password,

    
    onCheckForUpdates,
    onUpdateEngine,
    onSelectCookieFile,
    onClearCookieFile,
    refreshHealth,
    onResetStats,
    onRestartAndInstall,
    onUninstall,
  }
}
