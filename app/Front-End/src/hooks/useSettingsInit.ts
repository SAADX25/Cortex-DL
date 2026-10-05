import { useEffect } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'

/**
 * One-time side-effect wiring for the settings slice: IPC subscriptions,
 * localStorage persistence, and initial data fetches. Call exactly once,
 * near the app root (see `App.tsx`) — this replaces the effects that used
 * to live inline in the old `useSettingsController` god hook.
 */
export function useSettingsInit(): void {
  const lang = useSettingsStore((s) => s.lang)
  const concurrentDownloads = useSettingsStore((s) => s.concurrentDownloads)
  const totalDownloadedBytes = useSettingsStore((s) => s.totalDownloadedBytes)
  const username = useSettingsStore((s) => s.username)
  const password = useSettingsStore((s) => s.password)
  const setConcurrentDownloads = useSettingsStore((s) => s.setConcurrentDownloads)
  const setEngineVersion = useSettingsStore((s) => s.setEngineVersion)
  const setUpdateStatus = useSettingsStore((s) => s.setUpdateStatus)
  const setCookieFilePath = useSettingsStore((s) => s.setCookieFilePath)
  const setUsername = useSettingsStore((s) => s.setUsername)
  const setPassword = useSettingsStore((s) => s.setPassword)
  const setTotalDownloadedBytes = useSettingsStore((s) => s.setTotalDownloadedBytes)
  const refreshHealth = useSettingsStore((s) => s.refreshHealth)

  
  useEffect(() => {
    window.cortexDl.getConcurrency().then((val) => {
      if ([3, 5, 10].includes(val)) setConcurrentDownloads(val)
    }).catch(() => {})
    
  }, [setConcurrentDownloads])

  useEffect(() => {
    void refreshHealth()
    
  }, [refreshHealth])

  
  useEffect(() => {
    (async () => {
      try { setEngineVersion(await window.cortexDl.getEngineVersion()) }
      catch { setEngineVersion('Error') }
    })()
    
  }, [setEngineVersion])

  
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
  }, [setUpdateStatus])

  
  useEffect(() => { localStorage.setItem('cortex-notifications', 'true') }, [])

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
    
  }, [setCookieFilePath])

  
  useEffect(() => {
    (async () => {
      try {
        const [savedUser, savedPass] = await Promise.all([
          window.cortexDl.getSecureData('cortex-username'),
          window.cortexDl.getSecureData('cortex-password'),
        ])
        if (savedUser) setUsername(savedUser)
        if (savedPass) setPassword(savedPass)
        localStorage.removeItem('cortex-username')
        localStorage.removeItem('cortex-password')
      } catch (err) { console.error('Failed to load secure credentials', err) }
    })()
    
  }, [setUsername, setPassword])
  useEffect(() => { if (username !== '') window.cortexDl.saveSecureData('cortex-username', username) }, [username])
  useEffect(() => { if (password !== '') window.cortexDl.saveSecureData('cortex-password', password) }, [password])

  
  useEffect(() => {
    const statsDispose = window.cortexDl.onStatsUpdated(({ addedBytes }) => {
      setTotalDownloadedBytes((current) => current + addedBytes)
    })
    return () => { statsDispose() }
  }, [setTotalDownloadedBytes])
}
