import { useCallback, useEffect, useRef, useState } from 'react'
import { useUIStore } from '../../stores/useUIStore'

export function useFloatingPlayer(title: string, dir: 'ltr' | 'rtl') {
  const [host] = useState(() => document.createElement('div'))
  const [floatingWindow, setFloatingWindow] = useState<Window | null>(null)
  const popup = useRef<Window | null>(null)
  const detach = useRef<(() => void) | null>(null)
  const pendingMove = useRef<{ cancel: () => void; time: number; playing: boolean } | null>(null)
  const move = useCallback((target: HTMLElement) => {
    const video = host.querySelector('video')
    const time = pendingMove.current?.time ?? video?.currentTime ?? 0
    const playing = pendingMove.current?.playing ?? (!!video && !video.paused && !video.ended)
    pendingMove.current?.cancel(); pendingMove.current = null
    const modes = video ? [...video.textTracks].map(track => track.mode) : []
    target.appendChild(host)
    if (!video) return

    let cancelled = false
    const cancel = () => { cancelled = true; video.removeEventListener('loadedmetadata', resume) }
    const resume = () => {
      if (cancelled || video.readyState < 1) return
      cancel(); pendingMove.current = null
      if (Number.isFinite(time)) video.currentTime = time
      ;[...video.textTracks].forEach((track, index) => { track.mode = modes[index] ?? 'disabled' })
      if (playing) void video.play().catch(() => {})
    }
    pendingMove.current = { cancel, time, playing }
    video.addEventListener('loadedmetadata', resume)

    queueMicrotask(resume)
  }, [host])
  const restore = useCallback(() => {
    const child = popup.current
    popup.current = null
    detach.current?.(); detach.current = null
    move(document.body)
    setFloatingWindow(null)
    useUIStore.getState().setMediaPlayerFloating(false)
    if (child && !child.closed) child.close()
  }, [move])
  useEffect(() => {
    document.body.appendChild(host)
    return () => {
      detach.current?.(); detach.current = null
      const child = popup.current; popup.current = null

      document.body.appendChild(host)
      pendingMove.current?.cancel(); pendingMove.current = null
      if (child && !child.closed) child.close()
      host.remove()
      useUIStore.getState().setMediaPlayerFloating(false)
    }
  }, [host])
  const open = useCallback(() => {
    if (popup.current && !popup.current.closed) { popup.current.focus(); return }
    const child = window.open('about:blank', 'cortex-floating-player', 'width=560,height=399')
    if (!child) throw new Error('Floating player window could not open')
    try {
      child.document.title = title ? `${title} — Cortex DL` : 'Cortex DL'
      child.document.documentElement.dir = dir
      child.document.body.className = 'cortex-floating-player'
      child.document.body.style.margin = '0'
      const base = child.document.createElement('base'); base.href = document.baseURI
      child.document.head.appendChild(base)
      document.querySelectorAll('link[rel="stylesheet"], style').forEach(style => child.document.head.appendChild(style.cloneNode(true)))
      const restoreOnClose = () => restore()
      child.addEventListener('beforeunload', restoreOnClose)
      detach.current = () => child.removeEventListener('beforeunload', restoreOnClose)
      popup.current = child
      move(child.document.body)
      setFloatingWindow(child)
      useUIStore.getState().setMediaPlayerFloating(true)
    } catch (error) { child.close(); throw error }
  }, [dir, move, restore, title])
  return { host, floatingWindow, open, restore }
}
