import { useEffect, useState, useRef } from 'react'

type ProgressEvent = {
  id?: string
  fileName?: string
  percentage?: number
  speed?: number // bytes/sec
  bytes?: number
  totalBytes?: number | null
}

export default function SimpleDownloader() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('idle')
  const [percent, setPercent] = useState(0)
  const [speed, setSpeed] = useState(0)
  const [fileName, setFileName] = useState('')
  const disposeRef = useRef<(() => void) | undefined>()

  useEffect(() => {
    // Subscribe to progress events from main
    const disposer = window.cortexDl.onDownloadProgress((data: ProgressEvent) => {
      // data shape depends on engine; we expect percentage & speed
      if (data.fileName) setFileName(data.fileName)
      if (typeof data.percentage === 'number') setPercent(data.percentage)
      if (typeof data.speed === 'number') setSpeed(data.speed)
      if (data.percentage === 100) setStatus('completed')
      else if (data.percentage && data.percentage > 0) setStatus('downloading')
    })
    disposeRef.current = disposer
    return () => { disposeRef.current?.() }
  }, [])

  function formatSpeed(bytesPerSec: number) {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s'
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
    let i = 0
    let v = bytesPerSec
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(2)} ${units[i]}`
  }

  async function onDownload() {
    if (!url || url.trim() === '') return
    setStatus('queued')
    setPercent(0)
    setSpeed(0)
    setFileName('')

    try {
      // Provide a simple StartInput. You may want to let users choose directory elsewhere in your app.
      const directory = (await window.cortexDl.selectFolder()) || ''
      if (!directory) return

      await window.cortexDl.addDownload({
        url: url.trim(),
        directory,
        engine: 'auto',
        targetFormat: 'mp4'
      })

      // The main process will emit progress events which we subscribed to above
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8, width: 480 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste URL to download"
          style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: '#1f2937', color: '#fff', border: '1px solid #374151' }}
        />
        <button
          onClick={onDownload}
          style={{ padding: '10px 14px', borderRadius: 8, background: '#2563eb', color: '#fff', border: 'none' }}
        >Download</button>
      </div>

      <div style={{ height: 12, background: '#111827', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', background: '#10b981', transition: 'width 200ms' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9ca3af', fontSize: 13 }}>
        <div>{fileName || status}</div>
        <div>{formatSpeed(speed)}</div>
      </div>
    </div>
  )
}
