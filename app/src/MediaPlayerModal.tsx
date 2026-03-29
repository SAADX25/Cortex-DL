import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Play, Pause, Volume2, VolumeX, Maximize, Minimize, Eye, EyeOff } from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════════════
   Types & Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

interface MediaPlayerModalProps {
  isOpen: boolean
  filePath: string
  title?: string
  onClose: () => void
  dir?: 'ltr' | 'rtl'
}

type MediaType = 'video' | 'audio' | 'unknown'

function getMediaType(filePath: string): MediaType {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'ogv', 'm4v']
  const audioExts = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus', 'wma']
  if (videoExts.includes(ext)) return 'video'
  if (audioExts.includes(ext)) return 'audio'
  return 'unknown'
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const MEDIA_SERVER_PORT = 58888

function toStreamUrl(filePath: string): string {
  if (!filePath) return ''
  return `http://127.0.0.1:${MEDIA_SERVER_PORT}/?path=${encodeURIComponent(filePath)}`
}

/* ═══════════════════════════════════════════════════════════════════════════
   Shared Controls (Progress + Play/Volume row)
   Used identically by both VideoPlayerView and AudioPlayerView.
   ═══════════════════════════════════════════════════════════════════════════ */

interface ControlsProps {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  togglePlay: () => void
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  toggleMute: () => void
  /** Render extra buttons on the right (e.g. fullscreen). */
  extraRight?: React.ReactNode
}

function PlayerControls({
  isPlaying, currentTime, duration, volume, isMuted,
  togglePlay, onSeek, onVolumeChange, toggleMute, extraRight,
}: ControlsProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  return (
    <>
      <div className="progress-container">
        <input
          type="range"
          className="progress-slider"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={onSeek}
          style={{ '--progress': `${progress}%` } as React.CSSProperties}
        />
      </div>

      <div className="controls-row">
        <div className="controls-left">
          <button className="control-btn play-btn" onClick={togglePlay}>
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>
          <span className="time-display">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="controls-right">
          <button className="control-btn" onClick={toggleMute}>
            {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <input
            type="range"
            className="volume-slider"
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume}
            onChange={onVolumeChange}
            style={{ '--volume': `${(isMuted ? 0 : volume) * 100}%` } as React.CSSProperties}
          />
          {extraRight}
        </div>
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   VideoPlayerView
   – Cinematic: video fills container, overlays auto-hide, click to play.
   ═══════════════════════════════════════════════════════════════════════════ */

interface VideoViewProps {
  fileUrl: string
  title: string
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isFullscreen: boolean
  showControls: boolean
  isZenMode: boolean
  videoRef: React.RefObject<HTMLVideoElement>
  ambilightRef: React.RefObject<HTMLVideoElement>
  togglePlay: () => void
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  toggleMute: () => void
  toggleFullscreen: () => void
  onToggleZen: () => void
  onExitZen: () => void
  onTimeUpdate: () => void
  onLoadedMetadata: () => void
  onEnded: () => void
  onPlay: () => void
  onPause: () => void
  onClose: () => void
}

function VideoPlayerView({
  fileUrl, title, isPlaying, currentTime, duration, volume, isMuted,
  isFullscreen, showControls, isZenMode, videoRef, ambilightRef,
  togglePlay, onSeek, onVolumeChange, toggleMute, toggleFullscreen,
  onToggleZen, onExitZen,
  onTimeUpdate, onLoadedMetadata, onEnded, onPlay, onPause, onClose,
}: VideoViewProps) {
  return (
    <>
      {/* ── Video body (fills entire container) ── */}
      <div className="player-body">
        <div className="video-wrapper">
          {/* Ambilight background */}
          <video
            ref={ambilightRef}
            className="ambilight-video"
            src={fileUrl}
            muted
            playsInline
            loop
          />
          {/* Main video — click to play/pause or exit zen */}
          <video
            ref={videoRef}
            className="main-video"
            src={fileUrl}
            onClick={() => { if (isZenMode) { onExitZen(); } else { togglePlay(); } }}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onLoadedMetadata}
            onEnded={onEnded}
            onPlay={onPlay}
            onPause={onPause}
            playsInline
          />
        </div>
      </div>

      {/* ── Header overlay ── */}
      <div
        className="player-header"
        style={{
          opacity: isZenMode ? 0 : showControls ? 1 : 0,
          pointerEvents: isZenMode ? 'none' : showControls ? 'auto' : 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        <span className="player-header-title">{title}</span>
        <div className="player-header-actions">
          <button className="media-player-close" onClick={(e) => { e.stopPropagation(); onToggleZen(); }} title="Zen Mode">
            {isZenMode ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
          <button className="media-player-close" onClick={onClose}><X size={20} /></button>
        </div>
      </div>

      {/* ── Footer overlay ── */}
      <div
        className="player-footer"
        style={{
          opacity: isZenMode ? 0 : showControls ? 1 : 0,
          pointerEvents: isZenMode ? 'none' : showControls ? 'auto' : 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        <PlayerControls
          isPlaying={isPlaying} currentTime={currentTime} duration={duration}
          volume={volume} isMuted={isMuted}
          togglePlay={togglePlay} onSeek={onSeek}
          onVolumeChange={onVolumeChange} toggleMute={toggleMute}
          extraRight={
            <button className="control-btn" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          }
        />
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   AudioPlayerView
   – Premium vinyl layout. Controls are ALWAYS visible (no auto-hide).
   – Visualizer canvas is absolutely placed above the footer.
   ═══════════════════════════════════════════════════════════════════════════ */

interface AudioViewProps {
  fileUrl: string
  title: string
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isZenMode: boolean
  audioRef: React.RefObject<HTMLAudioElement>
  canvasRef: React.RefObject<HTMLCanvasElement>
  togglePlay: () => void
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  toggleMute: () => void
  onToggleZen: () => void
  onExitZen: () => void
  onTimeUpdate: () => void
  onLoadedMetadata: () => void
  onEnded: () => void
  onPlay: () => void
  onPause: () => void
  onClose: () => void
}

function AudioPlayerView({
  fileUrl, title, isPlaying, currentTime, duration, volume, isMuted, isZenMode,
  audioRef, canvasRef,
  togglePlay, onSeek, onVolumeChange, toggleMute, onToggleZen, onExitZen,
  onTimeUpdate, onLoadedMetadata, onEnded, onPlay, onPause, onClose,
}: AudioViewProps) {
  return (
    <>
      {/* Hidden <audio> element */}
      <audio
        ref={audioRef}
        src={fileUrl}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
        onPlay={onPlay}
        onPause={onPause}
        crossOrigin="anonymous"
      />

      {/* ── Header — always visible unless Zen Mode ── */}
      <div
        className="audio-player-header"
        style={{
          opacity: isZenMode ? 0 : 1,
          pointerEvents: isZenMode ? 'none' : 'auto',
        }}
      >
        <span className="player-header-title">{title}</span>
        <div className="player-header-actions">
          <button className="media-player-close" onClick={(e) => { e.stopPropagation(); onToggleZen(); }} title="Zen Mode">
            {isZenMode ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
          <button className="media-player-close" onClick={onClose}><X size={20} /></button>
        </div>
      </div>

      {/* ── Center stage: ambient glow + vinyl + track name ── */}
      <div className="audio-player-body" onClick={() => { if (isZenMode) onExitZen(); }}>
        <div className={`audio-ambient-bg ${isPlaying ? 'active' : ''}`} />
        <div className="audio-center-stage">
          <div className={`vinyl-record ${isPlaying ? 'spinning' : ''}`}>
            <div className="vinyl-groove vinyl-groove-1" />
            <div className="vinyl-groove vinyl-groove-2" />
            <div className="vinyl-groove vinyl-groove-3" />
            <div className="vinyl-groove vinyl-groove-4" />
            <div className="vinyl-label">
              <div className="vinyl-center-dot" />
            </div>
          </div>
          <p className="audio-track-name audio-track-name-spaced">{title || 'Now Playing'}</p>
        </div>
      </div>

      {/* ── Visualizer canvas — above the footer, never overlapping controls ── */}
      <div className="audio-visualizer-strip">
        <canvas
          ref={canvasRef}
          className="audio-visualizer"
          width={800}
          height={80}
        />
      </div>

      {/* ── Footer — always visible unless Zen Mode, solid background ── */}
      <div
        className="audio-player-footer"
        style={{
          opacity: isZenMode ? 0 : 1,
          pointerEvents: isZenMode ? 'none' : 'auto',
        }}
      >
        <PlayerControls
          isPlaying={isPlaying} currentTime={currentTime} duration={duration}
          volume={volume} isMuted={isMuted}
          togglePlay={togglePlay} onSeek={onSeek}
          onVolumeChange={onVolumeChange} toggleMute={toggleMute}
        />
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Modal (orchestrator)
   – Owns all shared state, refs, effects.
   – Delegates rendering to VideoPlayerView or AudioPlayerView.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function MediaPlayerModal({ isOpen, filePath, title, onClose, dir = 'ltr' }: MediaPlayerModalProps) {
  // ── State ──
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isZenMode, setIsZenMode] = useState(false)

  // ── Refs ──
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const ambilightRef = useRef<HTMLVideoElement>(null)
  const animationFrameRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)

  const mediaType = getMediaType(filePath)
  const fileUrl = toStreamUrl(filePath)
  const displayTitle = title || ''

  /* ── Helper: clear the auto-hide timer ── */
  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  /* ── Helper: start the auto-hide timer (video only) ── */
  const startHideTimer = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => setShowControls(false), 3000)
  }, [clearHideTimer])

  /* ───────────────────────────────────────────────────────────
     Web Audio API Visualizer (audio only)
     Full setup + teardown every open/close/filePath cycle.
     ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen || mediaType !== 'audio') return

    const audioEl = audioRef.current
    const canvas = canvasRef.current
    if (!audioEl || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let audioCtx: AudioContext
    let analyser: AnalyserNode
    let source: MediaElementAudioSourceNode
    let rafId: number

    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source = audioCtx.createMediaElementSource(audioEl)
      source.connect(analyser)
      analyser.connect(audioCtx.destination)
    } catch (e) {
      console.warn('[Visualizer] Web Audio setup failed:', e)
      return
    }

    audioContextRef.current = audioCtx
    analyserRef.current = analyser
    sourceRef.current = source

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      rafId = requestAnimationFrame(draw)
      animationFrameRef.current = rafId

      analyser.getByteFrequencyData(dataArray)

      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      const barCount = 64
      const gap = 3
      const barW = Math.max((W - gap * (barCount - 1)) / barCount, 2)
      const step = Math.floor(bufferLength / barCount)

      // Stroke-based vertical bars with rounded caps
      ctx.lineCap = 'round'
      ctx.lineWidth = barW

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step]
        const barH = (value / 255) * (H * 0.88)
        if (barH < 2) continue

        const x = i * (barW + gap) + barW / 2

        // Gradient from bottom to top of bar
        const grad = ctx.createLinearGradient(x, H, x, H - barH)
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.95)')
        grad.addColorStop(0.5, 'rgba(99, 102, 241, 0.88)')
        grad.addColorStop(1, 'rgba(167, 139, 250, 0.78)')

        // Subtle ambient glow
        ctx.shadowColor = 'rgba(138, 43, 226, 0.5)'
        ctx.shadowBlur = 10

        ctx.strokeStyle = grad
        ctx.beginPath()
        ctx.moveTo(x, H)
        ctx.lineTo(x, H - barH)
        ctx.stroke()

        // Extra glow on loud bars
        if (value > 185) {
          ctx.shadowColor = 'rgba(56, 189, 248, 0.7)'
          ctx.shadowBlur = 16
          ctx.beginPath()
          ctx.moveTo(x, H)
          ctx.lineTo(x, H - barH)
          ctx.stroke()
        }

        ctx.shadowBlur = 0
      }
    }

    draw()

    return () => {
      cancelAnimationFrame(rafId)
      animationFrameRef.current = null
      try { source.disconnect() } catch (_) {}
      try { analyser.disconnect() } catch (_) {}
      try { audioCtx.close() } catch (_) {}
      audioContextRef.current = null
      analyserRef.current = null
      sourceRef.current = null
    }
  }, [isOpen, mediaType, filePath])

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          isFullscreen ? document.exitFullscreen?.() : onClose()
          break
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          if (mediaRef.current) mediaRef.current.currentTime -= 5
          break
        case 'ArrowRight':
          if (mediaRef.current) mediaRef.current.currentTime += 5
          break
        case 'ArrowUp':
          setVolume(v => Math.min(1, v + 0.1))
          break
        case 'ArrowDown':
          setVolume(v => Math.max(0, v - 0.1))
          break
        case 'm':
          setIsMuted(m => !m)
          break
        case 'f':
          if (mediaType === 'video') toggleFullscreen()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isFullscreen, onClose, mediaType])

  /* ── Fullscreen change listener ── */
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  /* ── Reset on close & release file locks ── */
  useEffect(() => {
    if (!isOpen) {
      const release = (el: HTMLVideoElement | HTMLAudioElement | null) => {
        if (!el) return
        el.pause()
        el.removeAttribute('src')
        el.load()
      }
      release(videoRef.current)
      release(audioRef.current)
      release(ambilightRef.current)

      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
      clearHideTimer()
      setShowControls(true)
      setIsZenMode(false)
    }
  }, [isOpen, clearHideTimer])

  /* ── Sync mediaRef to the correct element ── */
  useEffect(() => {
    mediaRef.current = mediaType === 'video' ? videoRef.current : audioRef.current
  }, [mediaType])

  /* ── Apply volume ── */
  useEffect(() => {
    if (mediaRef.current) {
      mediaRef.current.volume = isMuted ? 0 : volume
    }
  }, [volume, isMuted])

  /* ── Video auto-hide: pause locks controls visible, play starts timer ── */
  useEffect(() => {
    if (mediaType !== 'video') return
    clearHideTimer()
    if (!isPlaying) {
      setShowControls(true)
    } else {
      startHideTimer()
    }
  }, [isPlaying, mediaType, clearHideTimer, startHideTimer])

  /* ── Sync ambilight video with main video ── */
  useEffect(() => {
    if (mediaType !== 'video') return
    if (videoRef.current && ambilightRef.current) {
      ambilightRef.current.currentTime = videoRef.current.currentTime
      if (isPlaying && ambilightRef.current.paused) {
        ambilightRef.current.play()
      } else if (!isPlaying && !ambilightRef.current.paused) {
        ambilightRef.current.pause()
      }
    }
  }, [isPlaying, currentTime, mediaType])

  /* ───────────────────────────────────────────────────────────
     Action handlers
     ─────────────────────────────────────────────────────────── */

  const togglePlay = () => {
    if (!mediaRef.current) return
    if (isPlaying) {
      mediaRef.current.pause()
    } else {
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume()
      }
      mediaRef.current.play()
    }
    setIsPlaying(p => !p)
  }

  const handleTimeUpdate = () => {
    if (mediaRef.current) setCurrentTime(mediaRef.current.currentTime)
  }

  const handleLoadedMetadata = () => {
    if (mediaRef.current) setDuration(mediaRef.current.duration)
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (mediaRef.current) {
      mediaRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value)
    setVolume(vol)
    setIsMuted(vol === 0)
  }

  const toggleMute = () => setIsMuted(m => !m)

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    document.fullscreenElement ? document.exitFullscreen() : containerRef.current.requestFullscreen()
  }

  /* ── Video-only: mouse move / leave for auto-hide ── */
  const handleMouseMove = () => {
    if (mediaType !== 'video' || isZenMode) return
    clearHideTimer()
    setShowControls(true)
    if (isPlaying) startHideTimer()
  }

  const handleMouseLeave = () => {
    if (mediaType !== 'video' || isZenMode) return
    clearHideTimer()
    if (isPlaying) setShowControls(false)
  }

  /* ── Zen Mode toggle ── */
  const toggleZenMode = () => {
    setIsZenMode(prev => {
      const entering = !prev
      if (entering) {
        // Entering zen: kill any auto-hide timer so nothing re-shows controls
        clearHideTimer()
      } else {
        // Exiting zen: restore controls and restart auto-hide if video is playing
        setShowControls(true)
        if (mediaType === 'video' && isPlaying) startHideTimer()
      }
      return entering
    })
  }

  const exitZenMode = () => {
    setIsZenMode(false)
    setShowControls(true)
    if (mediaType === 'video' && isPlaying) startHideTimer()
  }

  const onPlay = () => setIsPlaying(true)
  const onPause = () => setIsPlaying(false)

  const handleEnded = () => {
    setIsPlaying(false)
    setCurrentTime(0)
    if (mediaRef.current) mediaRef.current.currentTime = 0
  }

  /* ─────────────── Render ─────────────── */

  if (!isOpen) return null

  return (
    <div
      className="media-player-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      dir={dir}
    >
      <div
        ref={containerRef}
        className={`media-player-container ${mediaType}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {mediaType === 'video' && (
          <VideoPlayerView
            fileUrl={fileUrl}
            title={displayTitle}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            volume={volume}
            isMuted={isMuted}
            isFullscreen={isFullscreen}
            showControls={showControls}
            isZenMode={isZenMode}
            videoRef={videoRef}
            ambilightRef={ambilightRef}
            togglePlay={togglePlay}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeChange}
            toggleMute={toggleMute}
            toggleFullscreen={toggleFullscreen}
            onToggleZen={toggleZenMode}
            onExitZen={exitZenMode}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleEnded}
            onPlay={onPlay}
            onPause={onPause}
            onClose={onClose}
          />
        )}

        {mediaType === 'audio' && (
          <AudioPlayerView
            fileUrl={fileUrl}
            title={displayTitle}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            volume={volume}
            isMuted={isMuted}
            isZenMode={isZenMode}
            audioRef={audioRef}
            canvasRef={canvasRef}
            togglePlay={togglePlay}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeChange}
            toggleMute={toggleMute}
            onToggleZen={toggleZenMode}
            onExitZen={exitZenMode}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleEnded}
            onPlay={onPlay}
            onPause={onPause}
            onClose={onClose}
          />
        )}

        {mediaType === 'unknown' && (
          <div className="unsupported-media">
            <p>Unsupported file format</p>
          </div>
        )}
      </div>
    </div>
  )
}
