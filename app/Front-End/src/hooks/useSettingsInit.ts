// Hydrates persisted settings/credentials on mount and syncs updates back to Electron IPC and localStorage.
import { useEffect } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'

export function useSettingsInit(): void {
  const lang = useSettingsStore((s) => s.lang)
  const concurrentDownloads = useSettingsStore((s) => s.concurrentDownloads)
  const totalDownloadedBytes = useSettingsStore((s) => s.totalDownloadedBytes)
  const username = useSettingsStore((s) => s.username)
  const password = useSettingsStore((s) => s.password)
  const setConcurrentDownloads = useSettingsStore((s) => s.setConcurrentDownloads)
  const setEngineVersion = useSettingsStore((s) => s.setEngineVersion)
  const setUpdateStatus = useSettingsStore((s) => s.setUpdateStatus)
  const setUsername = useSettingsStore((s) => s.setUsername)
  const setPassword = useSettingsStore((s) => s.setPassword)
  const setTotalDownloadedBytes = useSettingsStore((s) => s.setTotalDownloadedBytes)

  useEffect(() => {
    window.cortexDl.getConcurrency().then((val) => {
      if ([3, 5, 10].includes(val)) setConcurrentDownloads(val)
    }).catch(() => {})

  }, [setConcurrentDownloads])

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

  // Debounce persistence so frequent download stats ticks don't hammer synchronous localStorage writes.
  useEffect(() => {
    const timer = setTimeout(() => localStorage.setItem('cortex-total-bytes', String(totalDownloadedBytes)), 1000)
    return () => clearTimeout(timer)
  }, [totalDownloadedBytes])

  useEffect(() => {
    (async () => {
      try {
        // Load credentials from encrypted storage and scrub legacy plaintext localStorage entries.
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
  // Skip empty strings so initial state doesn't clobber stored credentials before hydration finishes.
  useEffect(() => { if (username !== '') window.cortexDl.saveSecureData('cortex-username', username) }, [username])
  useEffect(() => { if (password !== '') window.cortexDl.saveSecureData('cortex-password', password) }, [password])

  useEffect(() => {
    const statsDispose = window.cortexDl.onStatsUpdated(({ addedBytes }) => {
      setTotalDownloadedBytes((current) => current + addedBytes)
    })
    return () => { statsDispose() }
  }, [setTotalDownloadedBytes])
}
