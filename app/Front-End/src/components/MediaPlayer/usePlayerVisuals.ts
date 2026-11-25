// Canvas rendering hooks for the in-app MediaPlayer: WebAudio frequency visualizer and 15fps video ambilight
import { useEffect, type MutableRefObject, type RefObject } from 'react'
import { clearMediaCanvas, releaseAudioGraph, stopPlayerFrame } from './mediaSession'
import { markAudioContext } from './mediaDiagnostics'

interface AudioVisualizerOptions {
  isOpen: boolean
  mediaType: 'video' | 'audio' | 'unknown'
  safeMode: boolean
  filePath: string
  audioRef: RefObject<HTMLAudioElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  isMiniModeRef: MutableRefObject<boolean>
  sessionClosedRef: MutableRefObject<boolean>
  animationFrameRef: MutableRefObject<number | null>
  audioContextRef: MutableRefObject<AudioContext | null>
  analyserRef: MutableRefObject<AnalyserNode | null>
  sourceRef: MutableRefObject<MediaElementAudioSourceNode | null>
  audioCleanupRef: MutableRefObject<(() => Promise<void>) | null>
}

export function useAudioVisualizer({
  isOpen,
  mediaType,
  safeMode,
  filePath,
  audioRef,
  canvasRef,
  isMiniModeRef,
  sessionClosedRef,
  animationFrameRef,
  audioContextRef,
  analyserRef,
  sourceRef,
  audioCleanupRef,
}: AudioVisualizerOptions): void {
  useEffect(() => {
    if (!isOpen || mediaType !== 'audio' || safeMode) return

    const audioEl = audioRef.current
    const canvas = canvasRef.current
    if (!audioEl || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (audioContextRef.current || sessionClosedRef.current) return
    let audioCtx: AudioContext | null = null
    let analyser: AnalyserNode
    let source: MediaElementAudioSourceNode
    let rafId: number | null = null

    try {
      const AudioCtxCtor = window.AudioContext || (window as any).webkitAudioContext
      audioCtx = new AudioCtxCtor()
      source = audioCtx.createMediaElementSource(audioEl)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyser.connect(audioCtx.destination)
    } catch (e) {
      console.warn('[Visualizer] Web Audio setup failed:', e)
      if (audioCtx) void audioCtx.close().catch(() => {})
      return
    }

    audioContextRef.current = audioCtx
    markAudioContext(true)
    analyserRef.current = analyser
    sourceRef.current = source
    if (!audioEl.paused && audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {})
    }

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      if (sessionClosedRef.current) return
      rafId = requestAnimationFrame(draw)
      animationFrameRef.current = rafId

      if (isMiniModeRef.current) return

      analyser.getByteFrequencyData(dataArray)

      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      const barCount = 64
      const gap = 3
      const barW = Math.max((W - gap * (barCount - 1)) / barCount, 2)
      const step = Math.floor(bufferLength / barCount)

      ctx.lineCap = 'round'
      ctx.lineWidth = barW

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step]
        const barH = (value / 255) * (H * 0.88)
        if (barH < 2) continue

        const x = i * (barW + gap) + barW / 2

        const grad = ctx.createLinearGradient(x, H, x, H - barH)
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.95)')
        grad.addColorStop(0.5, 'rgba(99, 102, 241, 0.88)')
        grad.addColorStop(1, 'rgba(167, 139, 250, 0.78)')

        ctx.strokeStyle = grad
        ctx.beginPath()
        ctx.moveTo(x, H)
        ctx.lineTo(x, H - barH)
        ctx.stroke()

        if (value > 185) {
          ctx.beginPath()
          ctx.moveTo(x, H)
          ctx.lineTo(x, H - barH)
          ctx.stroke()
        }
      }
    }

    draw()

    let cleaned = false
    audioCleanupRef.current = async () => {
      if (cleaned) return
      cleaned = true
      stopPlayerFrame(rafId)
      animationFrameRef.current = null

      audioContextRef.current = null
      analyserRef.current = null
      sourceRef.current = null
      audioCleanupRef.current = null
      clearMediaCanvas(canvas)
      await releaseAudioGraph(audioCtx, source, analyser)
      markAudioContext(false)
    }
  }, [
    safeMode,
    isOpen,
    mediaType,
    filePath,
    audioRef,
    canvasRef,
    isMiniModeRef,
    sessionClosedRef,
    animationFrameRef,
    audioContextRef,
    analyserRef,
    sourceRef,
    audioCleanupRef,
  ])
}

interface VideoAmbilightOptions {
  mediaType: 'video' | 'audio' | 'unknown'
  safeMode: boolean
  floatingWindow: Window | null
  isPlaying: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  ambilightRef: RefObject<HTMLCanvasElement | null>
  stopAmbilightRef: MutableRefObject<(() => void) | null>
}

export function useVideoAmbilight({
  mediaType,
  safeMode,
  floatingWindow,
  isPlaying,
  videoRef,
  ambilightRef,
  stopAmbilightRef,
}: VideoAmbilightOptions): void {
  useEffect(() => {
    if (mediaType !== 'video' || safeMode || floatingWindow) return

    let rafId: number | null = null
    let isActive = true
    let lastTime = 0
    const fpsLimit = 1000 / 15

    const drawAmbilightFrame = (timestamp: number) => {
      if (!isActive) return

      if (timestamp - lastTime >= fpsLimit) {
        const video = videoRef.current
        const canvas = ambilightRef.current

        if (video && canvas && !video.paused && !video.ended) {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            if (canvas.width !== 160) {
              canvas.width = 160
              canvas.height = Math.round((160 * video.videoHeight) / video.videoWidth)
            }
            const ctx = canvas.getContext('2d')
            if (ctx && video.videoWidth <= 2560) {
              try {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
              } catch (error) {
                console.debug('[Player canvas]', error)
              }
            }
          }
        }
        lastTime = timestamp
      }

      if (isActive) {
        rafId = requestAnimationFrame(drawAmbilightFrame)
      }
    }

    if (isPlaying) {
      rafId = requestAnimationFrame(drawAmbilightFrame)
    }

    const stop = () => {
      isActive = false
      stopPlayerFrame(rafId)
    }
    stopAmbilightRef.current = stop
    return () => {
      stop()
      if (stopAmbilightRef.current === stop) stopAmbilightRef.current = null
    }
  }, [floatingWindow, safeMode, isPlaying, mediaType, videoRef, ambilightRef, stopAmbilightRef])
}
