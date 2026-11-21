import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'
import {
  AlertCircle,
  Check,
  Crosshair,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  Repeat,
  RotateCcw,
  Scissors,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  Zap,
  ZoomIn,
  ZoomOut,
  Loader,
} from 'lucide-react'
import './AdvancedTrimmer.css'
import { TrimPreview, isHlsStreamUrl, seekPreview, videoFailure } from './trimPreview'
import { releaseMediaElement } from '../MediaPlayer/mediaSession'
import { applyTrimAudioControls, syncTrimAudio } from './trimAudio'
import {
  clampSeconds,
  computeRulerTicks,
  computeZoomViewport,
  formatClipBadge,
  formatCompactTime,
  formatTimecode,
  parseTimecode,
} from './trimTime'
import { type Language } from '../../translations'

export type TrimRange = {
  startSeconds: number
  endSeconds: number
  startTime: string
  endTime: string
}

type AdvancedTrimmerProps = {
  videoUrl: string
  originalUrl?: string
  duration: number
  isLive?: boolean
  initialStreamType?: 'progressive' | 'hls'
  lang?: Language
  initialStartTime?: string
  initialEndTime?: string
  trimMode?: 'fast' | 'exact'
  onTrimModeChange?: (mode: 'fast' | 'exact') => void
  onChange?: (range: TrimRange) => void
  onConfirm: (range: TrimRange) => void
}

const SLIDER_STEP_SECONDS = 0.1
const MIN_CLIP_SECONDS = 0.1
const PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const
const ZOOM_STEPS = [1, 2, 4, 8, 16, 32, 64] as const
const VOD_DURATION_PRESETS = [
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '30m', seconds: 1800 },
] as const
const LIVE_DURATION_PRESETS = [
  { label: '15s', seconds: 15 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '2m', seconds: 120 },
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '30m', seconds: 1800 },
  { label: '1h', seconds: 3600 },
] as const

function buildRange(startSeconds: number, endSeconds: number): TrimRange {
  return {
    startSeconds,
    endSeconds,
    startTime: formatTimecode(startSeconds),
    endTime: formatTimecode(endSeconds),
  }
}

const AdvancedTrimmer: React.FC<AdvancedTrimmerProps> = ({
  videoUrl,
  originalUrl,
  duration,
  isLive = false,
  initialStreamType,
  lang = 'en',
  initialStartTime,
  initialEndTime,
  trimMode = 'fast',
  onTrimModeChange,
  onChange,
  onConfirm,
}) => {
  const ar = lang === 'ar'
  const playerShellRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<TrimPreview | null>(null)

  const [detectedDuration, setDetectedDuration] = useState<number>(() => (Number.isFinite(duration) && duration > 0 ? duration : 0))
  const [detectedLive, setDetectedLive] = useState<boolean>(isLive)

  useEffect(() => {
    setDetectedDuration(Number.isFinite(duration) && duration > 0 ? duration : 0)
  }, [duration])

  useEffect(() => {
    setDetectedLive(isLive)
  }, [isLive])

  const effectiveIsLive = detectedLive || detectedDuration <= 0
  const safeDuration = effectiveIsLive ? 0 : detectedDuration

  const [startSeconds, setStartSeconds] = useState(() => {
    const parsed = parseTimecode(initialStartTime)
    return parsed == null ? 0 : clampSeconds(parsed, 0, Math.max(0, duration || 0))
  })
  const [endSeconds, setEndSeconds] = useState(() => {
    const parsed = parseTimecode(initialEndTime)
    const max = Math.max(0, duration || 0)
    return parsed == null ? max : clampSeconds(parsed, 0, max)
  })
  const [liveClipSeconds, setLiveClipSeconds] = useState(() => {
    const parsedEnd = parseTimecode(initialEndTime)
    const parsedStart = parseTimecode(initialStartTime) ?? 0
    if (parsedEnd != null && parsedEnd > parsedStart) return clampSeconds(Math.round(parsedEnd - parsedStart), 5, 21600)
    return 60
  })

  const [startDraft, setStartDraft] = useState(() => formatTimecode(startSeconds))
  const [endDraft, setEndDraft] = useState(() => formatTimecode(endSeconds))
  const [durationDraft, setDurationDraft] = useState(() => formatTimecode(Math.max(0, endSeconds - startSeconds)))
  const [liveDraft, setLiveDraft] = useState(() => formatTimecode(liveClipSeconds))

  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [streamType, setStreamType] = useState<'progressive' | 'hls'>(
    initialStreamType ?? (videoUrl && isHlsStreamUrl(videoUrl) ? 'hls' : 'progressive'),
  )
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [isResolvingStream, setIsResolvingStream] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [loopSelection, setLoopSelection] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [zoom, setZoom] = useState(1)
  const [viewStart, setViewStart] = useState(0)
  const [activeDrag, setActiveDrag] = useState<null | {
    kind: 'start' | 'end' | 'move' | 'scrub'
    originX: number
    originStart: number
    originEnd: number
  }>(null)

  const lastNonZeroVolume = useRef(1)
  const requestedSeek = useRef<number>(clampSeconds(parseTimecode(initialStartTime) ?? 0, 0, safeDuration))

  const isHlsActive = Boolean(streamUrl && (streamType === 'hls' || isHlsStreamUrl(streamUrl)))

  const currentRange = useMemo<TrimRange>(
    () => (effectiveIsLive ? buildRange(0, liveClipSeconds) : buildRange(startSeconds, endSeconds)),
    [effectiveIsLive, liveClipSeconds, startSeconds, endSeconds],
  )

  useEffect(() => {
    setStartDraft(formatTimecode(startSeconds))
    setEndDraft(formatTimecode(endSeconds))
    setDurationDraft(formatTimecode(Math.max(0, endSeconds - startSeconds)))
  }, [startSeconds, endSeconds])

  useEffect(() => {
    setLiveDraft(formatTimecode(liveClipSeconds))
  }, [liveClipSeconds])

  useEffect(() => {
    if (effectiveIsLive) return
    const parsedStart = parseTimecode(initialStartTime)
    const parsedEnd = parseTimecode(initialEndTime)
    const nextStart = parsedStart == null ? 0 : clampSeconds(parsedStart, 0, safeDuration)
    const nextEnd = parsedEnd == null ? safeDuration : clampSeconds(parsedEnd, nextStart, safeDuration)
    setStartSeconds(nextStart)
    setEndSeconds(nextEnd)
  }, [initialEndTime, initialStartTime, safeDuration, effectiveIsLive])

  useEffect(() => {
    const session = `trim-${crypto.randomUUID()}`
    const video = videoRef.current
    const audio = audioRef.current
    let disposed = false
    let extractedVideo = ''
    setAudioError(null)
    setIsPlaying(false)
    setCurrentTime(0)

    const preview = new TrimPreview(videoUrl, (source, error, loading) => {
      if (source !== extractedVideo) {
        releaseMediaElement(audio)
        setAudioUrl(null)
        setStreamType(source && isHlsStreamUrl(source) ? 'hls' : (initialStreamType ?? 'progressive'))
      }
      setStreamUrl(source)
      setStreamError(error)
      setIsResolvingStream(loading)
    })
    previewRef.current = preview

    void preview.start(originalUrl ? async () => {
      const streams = await window.cortexDl.getTrimPreviewStreams(originalUrl, session)
      if (!streams) throw new Error('Preview extraction cancelled')
      if (!disposed) {
        extractedVideo = streams.videoUrl
        setAudioUrl(streams.audioUrl ?? null)
        const nextType = streams.streamType ?? (isHlsStreamUrl(streams.videoUrl) ? 'hls' : 'progressive')
        setStreamType(nextType)
        if (streams.isLive) setDetectedLive(true)
        if (typeof streams.duration === 'number' && streams.duration > 0) {
          setDetectedDuration(streams.duration)
          setDetectedLive(false)
        }
      }
      return streams.videoUrl
    } : undefined)

    return () => {
      disposed = true
      preview.dispose()
      previewRef.current = null
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      releaseMediaElement(video)
      releaseMediaElement(audio)
      void window.cortexDl.closeMediaSession(session).catch((error) => console.error('[Visual Trim] Session cleanup failed:', error))
    }
  }, [videoUrl, originalUrl, initialStreamType])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (!streamUrl || !isHlsActive) return

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        backBufferLength: 10,
      })
      hlsRef.current = hls
      let recoveredMedia = false

      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        if (!data?.details) return
        if (data.details.live) {
          setDetectedLive(true)
        } else if (Number.isFinite(data.details.totalduration) && data.details.totalduration > 0) {
          setDetectedLive(false)
          setDetectedDuration((prev) => (prev > 0 ? prev : Math.round(data.details.totalduration)))
        }
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
          recoveredMedia = true
          hls.recoverMediaError()
          return
        }
        hls.destroy()
        if (hlsRef.current === hls) hlsRef.current = null
        previewRef.current?.fail(`HLS preview error: ${data.details || data.type}`)
      })

      hls.loadSource(streamUrl)
      hls.attachMedia(video)

      return () => {
        hls.destroy()
        if (hlsRef.current === hls) hlsRef.current = null
      }
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl
    } else {
      previewRef.current?.fail('HLS playback is not supported in this browser runtime')
    }
  }, [streamUrl, isHlsActive])

  useEffect(() => {
    applyTrimAudioControls(videoRef.current, audioRef.current, volume, muted, playbackRate)
  }, [volume, muted, playbackRate, audioUrl, streamUrl])

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(document.fullscreenElement === playerShellRef.current)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const syncAudio = useCallback((play = false) => {
    void syncTrimAudio(videoRef.current, audioRef.current, play).catch(() => {
      setAudioError(ar
        ? 'تعذر تشغيل صوت المعاينة. أوقف التشغيل وأعد المحاولة أو أعد تحليل الرابط.'
        : 'Preview audio could not play. Pause and play again, or reanalyze the source.')
    })
  }, [ar])

  const seekVideo = useCallback((seconds: number) => {
    if (effectiveIsLive) return
    const clamped = clampSeconds(seconds, 0, safeDuration)
    requestedSeek.current = clamped
    setCurrentTime(clamped)
    seekPreview(videoRef.current, clamped)
    seekPreview(audioRef.current, clamped)
  }, [effectiveIsLive, safeDuration])

  const emitChange = useCallback((nextStart: number, nextEnd: number) => {
    onChange?.(buildRange(nextStart, nextEnd))
  }, [onChange])

  const updateStart = useCallback((value: number, shouldSeek = true) => {
    if (effectiveIsLive) return
    const nextStart = clampSeconds(value, 0, Math.max(0, endSeconds - MIN_CLIP_SECONDS))
    setStartSeconds(nextStart)
    if (shouldSeek) seekVideo(nextStart)
    emitChange(nextStart, endSeconds)
  }, [effectiveIsLive, endSeconds, seekVideo, emitChange])

  const updateEnd = useCallback((value: number, shouldSeek = true) => {
    if (effectiveIsLive) return
    const nextEnd = clampSeconds(value, Math.min(safeDuration, startSeconds + MIN_CLIP_SECONDS), safeDuration)
    setEndSeconds(nextEnd)
    if (shouldSeek) seekVideo(nextEnd)
    emitChange(startSeconds, nextEnd)
  }, [effectiveIsLive, safeDuration, startSeconds, seekVideo, emitChange])

  const updateLiveDuration = useCallback((seconds: number) => {
    const next = clampSeconds(Math.round(seconds), 5, 21600)
    setLiveClipSeconds(next)
    onChange?.(buildRange(0, next))
  }, [onChange])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video || !streamUrl || streamError) return
    if (video.paused) {
      if (!effectiveIsLive && loopSelection && (video.currentTime < startSeconds || video.currentTime >= endSeconds - 0.05)) {
        seekVideo(startSeconds)
      }
      void video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [streamUrl, streamError, effectiveIsLive, loopSelection, startSeconds, endSeconds, seekVideo])

  const toggleMute = useCallback(() => {
    if (muted || volume === 0) {
      const restored = lastNonZeroVolume.current > 0.02 ? lastNonZeroVolume.current : 0.8
      setVolume(restored)
      setMuted(false)
      applyTrimAudioControls(videoRef.current, audioRef.current, restored, false, playbackRate)
    } else {
      lastNonZeroVolume.current = volume
      setMuted(true)
      applyTrimAudioControls(videoRef.current, audioRef.current, volume, true, playbackRate)
    }
  }, [muted, volume, playbackRate])

  const handleVolumeChange = useCallback((nextVolume: number) => {
    const clamped = clampSeconds(nextVolume, 0, 1)
    if (clamped > 0) lastNonZeroVolume.current = clamped
    setVolume(clamped)
    setMuted(clamped === 0)
    applyTrimAudioControls(videoRef.current, audioRef.current, clamped, clamped === 0, playbackRate)
  }, [playbackRate])

  const handleRateChange = useCallback((nextRate: number) => {
    setPlaybackRate(nextRate)
    applyTrimAudioControls(videoRef.current, audioRef.current, volume, muted, nextRate)
  }, [volume, muted])

  const toggleLoopPreview = useCallback(() => {
    setLoopSelection((prev) => {
      const next = !prev
      if (next && !effectiveIsLive) {
        seekVideo(startSeconds)
        void videoRef.current?.play().catch(() => {})
      }
      return next
    })
  }, [effectiveIsLive, seekVideo, startSeconds])

  const toggleFullscreen = useCallback(() => {
    const shell = playerShellRef.current
    if (!shell) return
    if (document.fullscreenElement === shell) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void shell.requestFullscreen().catch(() => {})
    }
  }, [])

  const viewport = useMemo(
    () => computeZoomViewport(safeDuration, zoom, viewStart),
    [safeDuration, zoom, viewStart],
  )

  useEffect(() => {
    if (viewStart !== viewport.viewStart) setViewStart(viewport.viewStart)
  }, [viewStart, viewport.viewStart])

  const rulerTicks = useMemo(
    () => (effectiveIsLive ? [] : computeRulerTicks(viewport.viewStart, viewport.viewEnd, 7)),
    [effectiveIsLive, viewport.viewStart, viewport.viewEnd],
  )

  const changeZoom = useCallback((nextZoom: number, focusTime?: number) => {
    if (safeDuration <= 0) return
    const clampedZoom = clampSeconds(nextZoom, 1, 64)
    const center = focusTime ?? (startSeconds + endSeconds) / 2
    const nextSpan = safeDuration / clampedZoom
    const nextStart = clampSeconds(center - nextSpan / 2, 0, Math.max(0, safeDuration - nextSpan))
    setZoom(clampedZoom)
    setViewStart(nextStart)
  }, [safeDuration, startSeconds, endSeconds])

  const zoomToSelection = useCallback(() => {
    if (safeDuration <= 0) return
    const clipLen = Math.max(MIN_CLIP_SECONDS, endSeconds - startSeconds)
    const targetZoom = clampSeconds(safeDuration / (clipLen * 1.35), 1, 64)
    changeZoom(targetZoom, (startSeconds + endSeconds) / 2)
  }, [safeDuration, startSeconds, endSeconds, changeZoom])

  const pointerToTime = useCallback((clientX: number): number => {
    const el = trackRef.current
    if (!el || viewport.viewDuration <= 0) return 0
    const rect = el.getBoundingClientRect()
    const ratio = clampSeconds((clientX - rect.left) / Math.max(1, rect.width), 0, 1)
    return viewport.viewStart + ratio * viewport.viewDuration
  }, [viewport.viewStart, viewport.viewDuration])

  useEffect(() => {
    if (!activeDrag || effectiveIsLive) return
    const onPointerMove = (event: PointerEvent) => {
      const el = trackRef.current
      if (!el || viewport.viewDuration <= 0) return
      const rect = el.getBoundingClientRect()
      const deltaSeconds = ((event.clientX - activeDrag.originX) / Math.max(1, rect.width)) * viewport.viewDuration

      if (activeDrag.kind === 'start') {
        const next = clampSeconds(activeDrag.originStart + deltaSeconds, 0, Math.max(0, endSeconds - MIN_CLIP_SECONDS))
        setStartSeconds(next)
        seekVideo(next)
        emitChange(next, endSeconds)
      } else if (activeDrag.kind === 'end') {
        const next = clampSeconds(activeDrag.originEnd + deltaSeconds, Math.min(safeDuration, startSeconds + MIN_CLIP_SECONDS), safeDuration)
        setEndSeconds(next)
        seekVideo(next)
        emitChange(startSeconds, next)
      } else if (activeDrag.kind === 'move') {
        const length = activeDrag.originEnd - activeDrag.originStart
        const nextStart = clampSeconds(activeDrag.originStart + deltaSeconds, 0, Math.max(0, safeDuration - length))
        const nextEnd = clampSeconds(nextStart + length, nextStart + MIN_CLIP_SECONDS, safeDuration)
        setStartSeconds(nextStart)
        setEndSeconds(nextEnd)
        seekVideo(nextStart)
        emitChange(nextStart, nextEnd)
      } else if (activeDrag.kind === 'scrub') {
        seekVideo(pointerToTime(event.clientX))
      }
    }
    const onPointerUp = () => setActiveDrag(null)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [activeDrag, effectiveIsLive, viewport.viewDuration, safeDuration, startSeconds, endSeconds, seekVideo, emitChange, pointerToTime])

  const commitStartDraft = () => {
    const parsed = parseTimecode(startDraft)
    if (parsed == null) {
      setStartDraft(formatTimecode(startSeconds))
      return
    }
    updateStart(parsed)
  }

  const commitEndDraft = () => {
    const parsed = parseTimecode(endDraft)
    if (parsed == null) {
      setEndDraft(formatTimecode(endSeconds))
      return
    }
    updateEnd(parsed)
  }

  const commitDurationDraft = () => {
    const parsed = parseTimecode(durationDraft)
    if (parsed == null || parsed < MIN_CLIP_SECONDS) {
      setDurationDraft(formatTimecode(Math.max(0, endSeconds - startSeconds)))
      return
    }
    updateEnd(Math.min(safeDuration, startSeconds + parsed))
  }

  const commitLiveDraft = () => {
    const parsed = parseTimecode(liveDraft)
    if (parsed == null || parsed < 5) {
      setLiveDraft(formatTimecode(liveClipSeconds))
      return
    }
    updateLiveDuration(parsed)
  }

  const handleReset = () => {
    if (effectiveIsLive) {
      updateLiveDuration(60)
      return
    }
    setZoom(1)
    setViewStart(0)
    setLoopSelection(false)
    setStartSeconds(0)
    setEndSeconds(safeDuration)
    seekVideo(0)
    emitChange(0, safeDuration)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    if (event.key === ' ' || event.key.toLowerCase() === 'k') {
      event.preventDefault()
      togglePlay()
    } else if (event.key.toLowerCase() === 'm') {
      event.preventDefault()
      toggleMute()
    } else if (!effectiveIsLive && event.key.toLowerCase() === 'i') {
      event.preventDefault()
      updateStart(currentTime, false)
    } else if (!effectiveIsLive && event.key.toLowerCase() === 'o') {
      event.preventDefault()
      updateEnd(currentTime, false)
    } else if (!effectiveIsLive && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      toggleLoopPreview()
    } else if (!effectiveIsLive && event.key === 'ArrowLeft') {
      event.preventDefault()
      seekVideo(currentTime - (event.shiftKey ? 1 : 5))
    } else if (!effectiveIsLive && event.key === 'ArrowRight') {
      event.preventDefault()
      seekVideo(currentTime + (event.shiftKey ? 1 : 5))
    }
  }

  const toViewPercent = (time: number): number => {
    if (viewport.viewDuration <= 0) return 0
    return ((time - viewport.viewStart) / viewport.viewDuration) * 100
  }

  const startPct = clampSeconds(toViewPercent(startSeconds), 0, 100)
  const endPct = clampSeconds(toViewPercent(endSeconds), 0, 100)
  const playheadPct = toViewPercent(currentTime)
  const playheadVisible = playheadPct >= 0 && playheadPct <= 100
  const clipDurationSeconds = Math.max(0, endSeconds - startSeconds)

  const sliderStyle = {
    '--trim-start': `${startPct}%`,
    '--trim-end': `${endPct}%`,
  } as React.CSSProperties & Record<'--trim-start' | '--trim-end', string>

  const effectiveVolume = muted ? 0 : volume
  const VolumeIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2

  return (
    <div
      className="advanced-trimmer"
      dir={ar ? 'rtl' : 'ltr'}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="advanced-trimmer__header">
        <div className="advanced-trimmer__title">
          <Scissors size={16} aria-hidden="true" />
          <span>{ar ? 'محرر القص الاحترافي' : 'Visual Trim Studio'}</span>
          {effectiveIsLive && (
            <span className="advanced-trimmer__live-pill" role="status">
              <Radio size={12} aria-hidden="true" />
              <span>{ar ? 'بث مباشر' : 'LIVE'}</span>
            </span>
          )}
          {!effectiveIsLive && safeDuration >= 1800 && (
            <span className="advanced-trimmer__fast-pill">
              {ar ? 'قص سريع للمقاطع الطويلة' : 'Fast Section Cut'}
            </span>
          )}
        </div>

        <div className="advanced-trimmer__time-pair" aria-live="polite" dir="ltr">
          <span>{currentRange.startTime}</span>
          <em className="advanced-trimmer__time-arrow">→</em>
          <span>{currentRange.endTime}</span>
          <strong className="advanced-trimmer__clip-badge">
            {formatClipBadge(currentRange.endSeconds - currentRange.startSeconds)}
          </strong>
        </div>
      </div>

      <div ref={playerShellRef} className={`advanced-trimmer__player-shell${isFullscreen ? ' is-fullscreen' : ''}`}>
        <div className="advanced-trimmer__video-wrap">
          {isResolvingStream && (
            <div className="advanced-trimmer__loading-overlay">
              <Loader size={28} className="advanced-trimmer__spinner" aria-hidden="true" />
              <span>{ar ? 'جاري تجهيز بث المعاينة…' : 'Preparing preview stream…'}</span>
            </div>
          )}
          {(streamError || audioError) && (
            <div className="advanced-trimmer__notice advanced-trimmer__notice--warn" role="status">
              <AlertCircle size={15} aria-hidden="true" />
              <span>
                {streamError
                  ? (ar
                      ? `المعاينة غير متاحة حالياً — ما زال بإمكانك تحديد وقت القص بدقة. ${streamError}`
                      : `Video preview unavailable — the trim range still works normally. ${streamError}`)
                  : audioError}
              </span>
            </div>
          )}

          <video
            ref={videoRef}
            className={`advanced-trimmer__video${streamError || isResolvingStream ? ' advanced-trimmer__video--hidden' : ''}`}
            src={isHlsActive ? undefined : (streamUrl ?? undefined)}
            muted={muted}
            playsInline
            preload="metadata"
            onClick={togglePlay}
            onPlay={() => {
              setIsPlaying(true)
              syncAudio(true)
            }}
            onPlaying={() => {
              setIsPlaying(true)
              syncAudio(true)
            }}
            onPause={() => {
              setIsPlaying(false)
              syncAudio()
            }}
            onEnded={() => {
              setIsPlaying(false)
              syncAudio()
            }}
            onWaiting={() => syncAudio()}
            onSeeking={() => syncAudio()}
            onSeeked={() => syncAudio(true)}
            onRateChange={(event) => {
              setPlaybackRate(event.currentTarget.playbackRate)
              syncAudio(!event.currentTarget.paused)
            }}
            onTimeUpdate={(event) => {
              const now = event.currentTarget.currentTime
              if (Number.isFinite(now)) {
                setCurrentTime(now)
                if (!effectiveIsLive && loopSelection && now >= endSeconds) {
                  seekVideo(startSeconds)
                }
              }
              syncAudio(!event.currentTarget.paused)
            }}
            onVolumeChange={(event) => {
              const nextMuted = event.currentTarget.muted
              const nextVol = event.currentTarget.volume
              setMuted(nextMuted)
              setVolume(nextVol)
              if (nextVol > 0) lastNonZeroVolume.current = nextVol
              if (audioRef.current) {
                audioRef.current.muted = nextMuted
                audioRef.current.volume = nextVol
              }
            }}
            onError={(event) => {
              if (isHlsActive || !streamUrl || event.currentTarget.currentSrc !== streamUrl) return
              previewRef.current?.fail(videoFailure(event.currentTarget))
            }}
            onLoadedMetadata={(event) => {
              if (!isHlsActive && event.currentTarget.currentSrc !== streamUrl) return
              applyTrimAudioControls(event.currentTarget, audioRef.current, volume, muted, playbackRate)
              const mediaDur = event.currentTarget.duration
              if (!effectiveIsLive && Number.isFinite(mediaDur) && Math.abs(mediaDur - safeDuration) > 1) {
                console.warn('[Visual Trim] Preview duration differs from analyzed duration:', mediaDur, safeDuration)
              }
              if (!effectiveIsLive) seekPreview(event.currentTarget, requestedSeek.current)
            }}
          />

          <audio
            ref={audioRef}
            data-trim-audio
            src={audioUrl ?? undefined}
            preload="metadata"
            hidden
            onLoadedMetadata={() => {
              applyTrimAudioControls(videoRef.current, audioRef.current, volume, muted, playbackRate)
              syncAudio(!videoRef.current?.paused)
            }}
            onError={() => {
              if (audioUrl) {
                setAudioError(ar
                  ? 'صوت المعاينة غير متاح أو انتهت صلاحية رابطه. أعد تحليل المصدر.'
                  : 'Preview audio is unavailable or its link expired. Reanalyze the source.')
              }
            }}
          />
        </div>

        <div className="advanced-trimmer__controls" dir="ltr">
          <div className="advanced-trimmer__controls-left">
            <button
              type="button"
              className="advanced-trimmer__icon-btn advanced-trimmer__icon-btn--primary"
              onClick={togglePlay}
              disabled={!streamUrl || Boolean(streamError)}
              aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
              title={isPlaying ? (ar ? 'إيقاف مؤقت (Space)' : 'Pause (Space)') : (ar ? 'تشغيل (Space)' : 'Play (Space)')}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>

            {!effectiveIsLive && (
              <>
                <button
                  type="button"
                  className="advanced-trimmer__icon-btn"
                  onClick={() => seekVideo(currentTime - 10)}
                  aria-label="Back 10 seconds"
                  title={ar ? 'رجوع 10 ثوانٍ' : 'Back 10s'}
                >
                  <SkipBack size={14} />
                  <span>10</span>
                </button>
                <button
                  type="button"
                  className="advanced-trimmer__icon-btn"
                  onClick={() => seekVideo(currentTime + 10)}
                  aria-label="Forward 10 seconds"
                  title={ar ? 'تقديم 10 ثوانٍ' : 'Forward 10s'}
                >
                  <SkipForward size={14} />
                  <span>10</span>
                </button>
                <button
                  type="button"
                  className={`advanced-trimmer__icon-btn${loopSelection ? ' is-active' : ''}`}
                  onClick={toggleLoopPreview}
                  aria-label="Loop trimmed clip"
                  aria-pressed={loopSelection}
                  title={ar ? 'معاينة وتكرار الجزء المقصوص (L)' : 'Preview & Loop Selection (L)'}
                >
                  <Repeat size={14} />
                </button>
              </>
            )}

            <div className="advanced-trimmer__audio-controls">
              <button
                type="button"
                className="advanced-trimmer__icon-btn"
                onClick={toggleMute}
                aria-label={effectiveVolume === 0 ? 'Unmute preview' : 'Mute preview'}
                title={effectiveVolume === 0 ? (ar ? 'إلغاء كتم الصوت (M)' : 'Unmute (M)') : (ar ? 'كتم الصوت (M)' : 'Mute (M)')}
              >
                <VolumeIcon size={15} />
              </button>
              <input
                type="range"
                className="advanced-trimmer__volume-slider"
                min={0}
                max={1}
                step={0.01}
                value={effectiveVolume}
                aria-label="Preview volume"
                onChange={(event) => handleVolumeChange(Number(event.currentTarget.value))}
              />
              <span className="advanced-trimmer__volume-pct">{Math.round(effectiveVolume * 100)}%</span>
            </div>
          </div>

          <div className="advanced-trimmer__controls-right">
            <span className="advanced-trimmer__clock">
              {effectiveIsLive
                ? (ar ? 'بث مباشر' : 'LIVE STREAM')
                : `${formatCompactTime(currentTime)} / ${formatCompactTime(safeDuration)}`}
            </span>

            {!effectiveIsLive && (
              <div className="advanced-trimmer__rate-group" role="group" aria-label="Playback speed">
                {PLAYBACK_RATES.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className={`advanced-trimmer__rate-btn${playbackRate === rate ? ' is-active' : ''}`}
                    onClick={() => handleRateChange(rate)}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              className="advanced-trimmer__icon-btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}
              title={isFullscreen ? (ar ? 'إنهاء ملء الشاشة' : 'Exit fullscreen') : (ar ? 'ملء الشاشة' : 'Fullscreen')}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>
      </div>

      {effectiveIsLive ? (
        <div className="advanced-trimmer__live-panel">
          <div className="advanced-trimmer__live-info">
            <strong>{ar ? 'مدة التسجيل من البث المباشر' : 'Live Stream Clip Length'}</strong>
            <span>
              {ar
                ? `سيتم قص وتسجيل ${formatTimecode(liveClipSeconds)} مباشرة من البث بجودة عالية.`
                : `Will capture and trim ${formatTimecode(liveClipSeconds)} directly from the live stream.`}
            </span>
          </div>

          <div className="advanced-trimmer__preset-row" dir="ltr">
            {LIVE_DURATION_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`advanced-trimmer__chip${liveClipSeconds === preset.seconds ? ' is-active' : ''}`}
                onClick={() => updateLiveDuration(preset.seconds)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="advanced-trimmer__live-custom" dir="ltr">
            <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateLiveDuration(liveClipSeconds - 30)}>-30s</button>
            <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateLiveDuration(liveClipSeconds - 10)}>-10s</button>
            <input
              type="text"
              className="advanced-trimmer__time-input"
              value={liveDraft}
              aria-label="Live clip duration"
              onChange={(event) => setLiveDraft(event.currentTarget.value)}
              onBlur={commitLiveDraft}
              onKeyDown={(event) => { if (event.key === 'Enter') commitLiveDraft() }}
            />
            <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateLiveDuration(liveClipSeconds + 10)}>+10s</button>
            <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateLiveDuration(liveClipSeconds + 30)}>+30s</button>
          </div>
        </div>
      ) : (
        <>
          <div className="advanced-trimmer__timeline-section">
            <div className="advanced-trimmer__timeline-bar">
              <div className="advanced-trimmer__timeline-meta">
                <span>{ar ? 'طول المقطع:' : 'Clip:'} <strong>{formatTimecode(clipDurationSeconds)}</strong></span>
                <span className="advanced-trimmer__divider">•</span>
                <span>{ar ? 'التكبير:' : 'Zoom:'} <strong>{zoom}x</strong></span>
              </div>

              <div className="advanced-trimmer__zoom-controls" dir="ltr">
                <button
                  type="button"
                  className="advanced-trimmer__mini-btn"
                  disabled={zoom <= 1}
                  onClick={() => {
                    const prev = [...ZOOM_STEPS].reverse().find((z) => z < zoom) ?? 1
                    changeZoom(prev)
                  }}
                  aria-label="Zoom out timeline"
                  title={ar ? 'تصغير الشريط الزمني' : 'Zoom out'}
                >
                  <ZoomOut size={13} />
                </button>
                <button
                  type="button"
                  className="advanced-trimmer__mini-btn"
                  disabled={zoom >= 64}
                  onClick={() => {
                    const next = ZOOM_STEPS.find((z) => z > zoom) ?? 64
                    changeZoom(next)
                  }}
                  aria-label="Zoom in timeline"
                  title={ar ? 'تكبير الشريط الزمني لدقة أعلى' : 'Zoom in for long videos'}
                >
                  <ZoomIn size={13} />
                </button>
                <button
                  type="button"
                  className="advanced-trimmer__mini-btn"
                  onClick={zoomToSelection}
                  title={ar ? 'تقريب على الجزء المحدد' : 'Fit selection'}
                >
                  {ar ? 'تقريب المحدد' : 'Fit Clip'}
                </button>
                {zoom > 1 && (
                  <button
                    type="button"
                    className="advanced-trimmer__mini-btn"
                    onClick={() => { setZoom(1); setViewStart(0) }}
                  >
                    1x
                  </button>
                )}
              </div>
            </div>

            <div
              className="advanced-trimmer__ruler"
              dir="ltr"
              onPointerDown={(event) => {
                seekVideo(pointerToTime(event.clientX))
                setActiveDrag({ kind: 'scrub', originX: event.clientX, originStart: startSeconds, originEnd: endSeconds })
              }}
            >
              {rulerTicks.map((tick) => (
                <div
                  key={`${tick.time}-${tick.major}`}
                  className={`advanced-trimmer__tick${tick.major ? ' is-major' : ''}`}
                  style={{ left: `${tick.percent}%` }}
                >
                  <span className="advanced-trimmer__tick-line" />
                  {tick.major && <span className="advanced-trimmer__tick-label">{tick.label}</span>}
                </div>
              ))}
            </div>

            <div
              ref={trackRef}
              className="advanced-trimmer__track"
              dir="ltr"
              style={sliderStyle}
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest('[data-trim-handle],[data-trim-selection]')) return
                seekVideo(pointerToTime(event.clientX))
                setActiveDrag({ kind: 'scrub', originX: event.clientX, originStart: startSeconds, originEnd: endSeconds })
              }}
              onWheel={(event) => {
                if (safeDuration <= 0) return
                if (event.ctrlKey) {
                  event.preventDefault()
                  const factor = event.deltaY < 0 ? 1.5 : 1 / 1.5
                  changeZoom(zoom * factor, pointerToTime(event.clientX))
                } else if (zoom > 1) {
                  event.preventDefault()
                  const shift = (event.deltaY > 0 ? 1 : -1) * viewport.viewDuration * 0.15
                  setViewStart((prev) => clampSeconds(prev + shift, 0, Math.max(0, safeDuration - viewport.viewDuration)))
                }
              }}
            >
              <div className="advanced-trimmer__mask advanced-trimmer__mask--left" style={{ width: `${startPct}%` }} />
              <div className="advanced-trimmer__mask advanced-trimmer__mask--right" style={{ width: `${Math.max(0, 100 - endPct)}%` }} />

              <div
                data-trim-selection
                className="advanced-trimmer__selection"
                style={{ left: `${startPct}%`, width: `${Math.max(0.5, endPct - startPct)}%` }}
                title={ar ? 'اسحب لتحريك نافذة القص' : 'Drag to move clip window'}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  setActiveDrag({ kind: 'move', originX: event.clientX, originStart: startSeconds, originEnd: endSeconds })
                }}
              />

              <button
                type="button"
                data-trim-handle="start"
                className={`advanced-trimmer__handle advanced-trimmer__handle--start${activeDrag?.kind === 'start' ? ' is-dragging' : ''}`}
                style={{ left: `${startPct}%` }}
                aria-label="Drag trim start handle"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  setActiveDrag({ kind: 'start', originX: event.clientX, originStart: startSeconds, originEnd: endSeconds })
                }}
              >
                <span className="advanced-trimmer__handle-grip" />
              </button>

              <button
                type="button"
                data-trim-handle="end"
                className={`advanced-trimmer__handle advanced-trimmer__handle--end${activeDrag?.kind === 'end' ? ' is-dragging' : ''}`}
                style={{ left: `${endPct}%` }}
                aria-label="Drag trim end handle"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  setActiveDrag({ kind: 'end', originX: event.clientX, originStart: startSeconds, originEnd: endSeconds })
                }}
              >
                <span className="advanced-trimmer__handle-grip" />
              </button>

              {playheadVisible && (
                <div className="advanced-trimmer__playhead" style={{ left: `${playheadPct}%` }} aria-hidden="true" />
              )}

              <input
                className="advanced-trimmer__range advanced-trimmer__range--start"
                type="range"
                min={0}
                max={safeDuration}
                step={SLIDER_STEP_SECONDS}
                value={startSeconds}
                aria-label="Trim start"
                onChange={(event) => updateStart(Number(event.currentTarget.value))}
              />
              <input
                className="advanced-trimmer__range advanced-trimmer__range--end"
                type="range"
                min={0}
                max={safeDuration}
                step={SLIDER_STEP_SECONDS}
                value={endSeconds}
                aria-label="Trim end"
                onChange={(event) => updateEnd(Number(event.currentTarget.value))}
              />
            </div>

            {zoom > 1 && (
              <div className="advanced-trimmer__pan-row" dir="ltr">
                <span className="advanced-trimmer__pan-label">{formatCompactTime(viewport.viewStart)}</span>
                <input
                  type="range"
                  className="advanced-trimmer__pan-slider"
                  min={0}
                  max={Math.max(0, safeDuration - viewport.viewDuration)}
                  step={Math.max(0.1, viewport.viewDuration / 200)}
                  value={viewport.viewStart}
                  aria-label="Pan zoomed timeline"
                  onChange={(event) => setViewStart(Number(event.currentTarget.value))}
                />
                <span className="advanced-trimmer__pan-label">{formatCompactTime(viewport.viewEnd)}</span>
              </div>
            )}
          </div>

          <div className="advanced-trimmer__precision-grid">
            <div className="advanced-trimmer__field-card">
              <div className="advanced-trimmer__field-head">
                <label htmlFor="trim-start-input">{ar ? 'نقطة البداية (In)' : 'Start (In)'}</label>
                <button
                  type="button"
                  className="advanced-trimmer__mark-btn"
                  onClick={() => updateStart(currentTime, false)}
                  title={ar ? 'تعيين من موضع التشغيل الحالي (I)' : 'Set to current playhead (I)'}
                >
                  {ar ? 'من المؤشر [I]' : 'Use Current [I]'}
                </button>
              </div>
              <div className="advanced-trimmer__field-row" dir="ltr">
                <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateStart(startSeconds - 5)}>-5s</button>
                <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateStart(startSeconds - 1)}>-1s</button>
                <input
                  id="trim-start-input"
                  type="text"
                  className="advanced-trimmer__time-input"
                  value={startDraft}
                  aria-label="Start time"
                  onChange={(event) => setStartDraft(event.currentTarget.value)}
                  onBlur={commitStartDraft}
                  onKeyDown={(event) => { if (event.key === 'Enter') commitStartDraft() }}
                />
                <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateStart(startSeconds + 1)}>+1s</button>
                <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateStart(startSeconds + 5)}>+5s</button>
              </div>
            </div>

            <div className="advanced-trimmer__field-card">
              <div className="advanced-trimmer__field-head">
                <label htmlFor="trim-duration-input">{ar ? 'مدة المقطع' : 'Clip Duration'}</label>
                <div className="advanced-trimmer__quick-chips" dir="ltr">
                  {VOD_DURATION_PRESETS.filter((p) => p.seconds <= safeDuration).slice(0, 4).map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="advanced-trimmer__tiny-chip"
                      onClick={() => updateEnd(Math.min(safeDuration, startSeconds + preset.seconds))}
                    >
                      +{preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="advanced-trimmer__field-row" dir="ltr">
                <input
                  id="trim-duration-input"
                  type="text"
                  className="advanced-trimmer__time-input advanced-trimmer__time-input--wide"
                  value={durationDraft}
                  aria-label="Clip duration"
                  onChange={(event) => setDurationDraft(event.currentTarget.value)}
                  onBlur={commitDurationDraft}
                  onKeyDown={(event) => { if (event.key === 'Enter') commitDurationDraft() }}
                />
              </div>
            </div>

            <div className="advanced-trimmer__field-card">
              <div className="advanced-trimmer__field-head">
                <label htmlFor="trim-end-input">{ar ? 'نقطة النهاية (Out)' : 'End (Out)'}</label>
                <button
                  type="button"
                  className="advanced-trimmer__mark-btn"
                  onClick={() => updateEnd(currentTime, false)}
                  title={ar ? 'تعيين من موضع التشغيل الحالي (O)' : 'Set to current playhead (O)'}
                >
                  {ar ? 'من المؤشر [O]' : 'Use Current [O]'}
                </button>
              </div>
              <div className="advanced-trimmer__field-row" dir="ltr">
                <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateEnd(endSeconds - 5)}>-5s</button>
                <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateEnd(endSeconds - 1)}>-1s</button>
                <input
                  id="trim-end-input"
                  type="text"
                  className="advanced-trimmer__time-input"
                  value={endDraft}
                  aria-label="End time"
                  onChange={(event) => setEndDraft(event.currentTarget.value)}
                  onBlur={commitEndDraft}
                  onKeyDown={(event) => { if (event.key === 'Enter') commitEndDraft() }}
                />
                <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateEnd(endSeconds + 1)}>+1s</button>
                <button type="button" className="advanced-trimmer__nudge-btn" onClick={() => updateEnd(endSeconds + 5)}>+5s</button>
              </div>
            </div>
          </div>

          {onTrimModeChange && (
            <div className="advanced-trimmer__mode-bar">
              <div className="advanced-trimmer__mode-toggle" role="group" aria-label={ar ? 'وضع القص' : 'Trim mode'}>
                <button
                  type="button"
                  className={`advanced-trimmer__mode-btn${trimMode === 'fast' ? ' is-active' : ''}`}
                  onClick={() => onTrimModeChange('fast')}
                  aria-pressed={trimMode === 'fast'}
                  title={ar
                    ? 'نسخ مباشر بدون إعادة ضغط — خفيف جداً على المعالج وبنفس الجودة الأصلية'
                    : 'Lossless stream copy — minimal CPU usage, finishes in seconds'}
                >
                  <Zap size={13} aria-hidden="true" />
                  <span>{ar ? 'قص سريع (خفيف على المعالج)' : 'Fast Cut (Low CPU)'}</span>
                </button>
                <button
                  type="button"
                  className={`advanced-trimmer__mode-btn${trimMode === 'exact' ? ' is-active is-exact' : ''}`}
                  onClick={() => onTrimModeChange('exact')}
                  aria-pressed={trimMode === 'exact'}
                  title={ar
                    ? 'دقة كاملة للثانية مع إعادة ترميز محدودة المعالج'
                    : 'Frame-accurate cut with CPU-capped re-encoding'}
                >
                  <Crosshair size={13} aria-hidden="true" />
                  <span>{ar ? 'قص دقيق للثانية' : 'Exact Cut'}</span>
                </button>
              </div>
              <span className="advanced-trimmer__mode-hint">
                {trimMode === 'fast'
                  ? (ar ? 'نسخ فوري بدون ضغط (~5% معالج · قد يتقرب ±1-3ث لأقرب إطار رئيسي)' : 'Instant lossless copy (~5% CPU · snaps ±1–3s to keyframe)')
                  : (ar ? 'دقة كاملة للثانية مع تحديد أنوية المعالج لتفادي استهلاك 100%' : 'Exact second precision with capped CPU threads')}
              </span>
            </div>
          )}
        </>
      )}

      <div className="advanced-trimmer__footer">
        <div className="advanced-trimmer__footer-main">
          <button className="advanced-trimmer__ghost-btn" type="button" onClick={handleReset}>
            <RotateCcw size={15} aria-hidden="true" />
            <span>{ar ? 'إعادة تعيين' : 'Reset'}</span>
          </button>
          <span className="advanced-trimmer__shortcuts-hint">
            {effectiveIsLive
              ? (ar ? 'Space تشغيل · M كتم الصوت' : 'Space Play · M Mute')
              : (ar ? 'Space تشغيل · M كتم · I بداية · O نهاية · L تكرار' : 'Space Play · M Mute · I In · O Out · L Loop')}
          </span>
        </div>
        <button className="advanced-trimmer__save-btn" type="button" onClick={() => onConfirm(currentRange)}>
          <Check size={16} aria-hidden="true" />
          <span>{ar ? 'حفظ القص' : 'Save Trim'}</span>
        </button>
      </div>
    </div>
  )
}

export default AdvancedTrimmer
