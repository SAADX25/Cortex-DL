import { useEffect, useState, useRef } from 'react'
import { useHighFrequencyIPC } from '../hooks/useHighFrequencyIPC'
import { useTask } from '../stores/downloadStore'

/**
 * SimpleDownloader — High-Performance URL Input with Uncontrolled Component.
 *
 * Deep-clean: no direct IPC subscriptions here.
 * Volatile updates are handled exclusively by `useHighFrequencyIPC.ts`.
 */
export default function SimpleDownloader() {
  const [status, setStatus] = useState('idle')
  const [fileName, setFileName] = useState('')
  const [activeTaskId, setActiveTaskId] = useState<string | undefined>(undefined)

  const task = useTask(activeTaskId || '')

  // Uncontrolled URL Input
  const urlInputRef = useRef<HTMLInputElement>(null)

  // Direct DOM refs for volatile metrics
  const progressBarRef = useRef<HTMLDivElement>(null)
  const percentTextRef = useRef<HTMLSpanElement>(null)
  const speedTextRef = useRef<HTMLSpanElement>(null)

  // DOM-fast-path driven by the single shared IPC listeners.
  useHighFrequencyIPC(activeTaskId, {
    progressBarRef,
    speedTextRef,
    percentTextRef,
  })

  useEffect(() => {
    if (!task) return
    setFileName(task.title || task.filename || '')
    setStatus(task.status)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.title, task?.filename, task?.status])

  async function onDownload() {
    const url = urlInputRef.current?.value?.trim() || ''
    if (!url) return

    setStatus('queued')
    setFileName('')
    setActiveTaskId(undefined)

    // Reset DOM
    if (progressBarRef.current) progressBarRef.current.style.width = '0%'
    if (percentTextRef.current) percentTextRef.current.innerText = '0%'
    if (speedTextRef.current) speedTextRef.current.innerText = '0 B/s'

    try {
      const directory = (await window.cortexDl.selectFolder()) || ''
      if (!directory) return

      const newTask = await window.cortexDl.addDownload({
        url,
        directory,
        engine: 'auto',
        targetFormat: 'mp4',
      })

      setActiveTaskId(newTask.id)

      // Clear input only on successful submission
      if (urlInputRef.current) urlInputRef.current.value = ''
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void onDownload()
  }

  return (
    <div style={{ display: 'grid', gap: 8, width: 480 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={urlInputRef}
          onKeyDown={handleKeyDown}
          placeholder="Paste URL to download (press Enter to submit)"
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: 8,
            background: '#1f2937',
            color: '#fff',
            border: '1px solid #374151',
          }}
        />
        <button
          onClick={() => void onDownload()}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Add Link
        </button>
      </div>

      <div
        style={{
          height: 12,
          background: '#111827',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <div
          ref={progressBarRef}
          style={{
            width: '0%',
            height: '100%',
            background: '#10b981',
            transition: 'width 200ms',
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: '#9ca3af',
          fontSize: 13,
        }}
      >
        <div>{fileName || status}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span ref={speedTextRef}>0 B/s</span>
          <span ref={percentTextRef}>0%</span>
        </div>
      </div>
    </div>
  )
}

