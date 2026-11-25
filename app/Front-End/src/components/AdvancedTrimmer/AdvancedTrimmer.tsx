// Visual trim editor for VODs (zoomable timeline + dual handles) and live streams (duration capture)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { AlertCircle, Check, Loader, Radio, RotateCcw, Scissors } from 'lucide-react'
import './AdvancedTrimmer.css'
import {
  TrimPreview,
  isHlsStreamUrl,
  seekPreview,
  validatePreviewUrl,
  videoFailure,
} from './trimPreview'
import { releaseMediaElement } from '../MediaPlayer/mediaSession'
import { applyTrimAudioControls, isAbortPlaybackError, syncTrimAudio } from './trimAudio'
import {
  clampSeconds,
  computeRulerTicks,
  computeZoomViewport,
  formatClipBadge,
  formatTimecode,
  parseTimecode,
} from './trimTime'
import { TrimmerControls } from './TrimmerControls'
import { TrimmerLivePanel } from './TrimmerLivePanel'
import { TrimmerTimeline, type DragState } from './TrimmerTimeline'
import { TrimmerPrecisionPanel } from './TrimmerPrecisionPanel'
import { formatMessage, translations, type Language } from '../../translations'

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

const MIN_CLIP_SECONDS = 0.1

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
  const tr = translations[lang].trimmer
  const playerShellRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<TrimPreview | null>(null)

  const [detectedDuration, setDetectedDuration] = useState<number>(() =>
    Number.isFinite(duration) && duration > 0 ? duration : 0,
  )
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
    if (parsedEnd != null && parsedEnd > parsedStart)
      return clampSeconds(Math.round(parsedEnd - parsedStart), 5, 21600)
    return 60
  })

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
  const [activeDrag, setActiveDrag] = useState<DragState>(null)

  const lastNonZeroVolume = useRef(1)
  const startSecondsRef = useRef(startSeconds)
  startSecondsRef.current = startSeconds
  const endSecondsRef = useRef(endSeconds)
  endSecondsRef.current = endSeconds
  const lastEmittedRef = useRef<{ start: string; end: string } | null>(null)
  const requestedSeek = useRef<number>(
    clampSeconds(parseTimecode(initialStartTime) ?? 0, 0, safeDuration),
  )

  const isHlsActive = Boolean(streamUrl && (streamType === 'hls' || isHlsStreamUrl(streamUrl)))

  const currentRange = useMemo<TrimRange>(
    () => (effectiveIsLive ? buildRange(0, liveClipSeconds) : buildRange(startSeconds, endSeconds)),
    [effectiveIsLive, liveClipSeconds, startSeconds, endSeconds],
  )

  useEffect(() => {
    setLiveDraft(formatTimecode(liveClipSeconds))
  }, [liveClipSeconds])

  useEffect(() => {
    if (effectiveIsLive) return
    if (
      lastEmittedRef.current &&
      initialStartTime === lastEmittedRef.current.start &&
      initialEndTime === lastEmittedRef.current.end &&
      endSecondsRef.current <= safeDuration
    ) {
      return
    }
    const parsedStart = parseTimecode(initialStartTime)
    const parsedEnd = parseTimecode(initialEndTime)
    const nextStart = parsedStart == null ? 0 : clampSeconds(parsedStart, 0, safeDuration)
    const nextEnd =
      parsedEnd == null ? safeDuration : clampSeconds(parsedEnd, nextStart, safeDuration)
    setStartSeconds(nextStart)
    setEndSeconds(nextEnd)
  }, [initialEndTime, initialStartTime, safeDuration, effectiveIsLive])

  // Resolve preview streams lazily and clean up any active media/HLS handles on unmount
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
        setStreamType(
          source && isHlsStreamUrl(source) ? 'hls' : (initialStreamType ?? 'progressive'),
        )
      }
      setStreamUrl(source)
      setStreamError(error)
      setIsResolvingStream(loading)
    })
    previewRef.current = preview

    void preview.start(
      originalUrl
        ? async () => {
            const streams = await window.cortexDl.getTrimPreviewStreams(originalUrl, session)
            if (!streams) throw new Error('Preview extraction cancelled')
            const normalizedVideoUrl = validatePreviewUrl(streams.videoUrl)
            if (!disposed) {
              extractedVideo = normalizedVideoUrl
              setAudioUrl(streams.audioUrl ?? null)
              const nextType =
                streams.streamType ?? (isHlsStreamUrl(normalizedVideoUrl) ? 'hls' : 'progressive')
              setStreamType(nextType)
              if (streams.isLive) setDetectedLive(true)
              if (typeof streams.duration === 'number' && streams.duration > 0) {
                setDetectedDuration(streams.duration)
                setDetectedLive(false)
              }
            }
            return normalizedVideoUrl
          }
        : undefined,
    )

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
      void window.cortexDl
        .closeMediaSession(session)
        .catch(error => console.error('[Visual Trim] Session cleanup failed:', error))
    }
  }, [videoUrl, originalUrl, initialStreamType])

  // Attach hls.js lazily only for live/VOD m3u8 streams; progressive MP4/WebM bind directly via video.src
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (!streamUrl || !isHlsActive) return

    let cancelled = false
    let localHls: Hls | null = null

    const attachHls = async () => {
      try {
        const { default: HlsCtor } = await import('hls.js')
        if (cancelled || videoRef.current !== video) return

        if (HlsCtor.isSupported()) {
          const hls = new HlsCtor({
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: 20,
            maxMaxBufferLength: 40,
            backBufferLength: 10,
          })
          localHls = hls
          hlsRef.current = hls
          let recoveredMedia = false

          hls.on(HlsCtor.Events.LEVEL_LOADED, (_event, data) => {
            if (cancelled || !data?.details) return
            if (data.details.live) {
              setDetectedLive(true)
            } else if (
              Number.isFinite(data.details.totalduration) &&
              data.details.totalduration > 0
            ) {
              setDetectedLive(false)
              setDetectedDuration(prev =>
                prev > 0 ? prev : Math.round(data.details.totalduration),
              )
            }
          })

          hls.on(HlsCtor.Events.ERROR, (_event, data) => {
            if (cancelled || !data.fatal) return
            if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
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
          return
        }

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = streamUrl
        } else {
          previewRef.current?.fail('HLS playback is not supported in this browser runtime')
        }
      } catch (err) {
        if (!cancelled) {
          previewRef.current?.fail(
            `HLS preview failed to load: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }

    void attachHls()

    return () => {
      cancelled = true
      if (localHls) {
        localHls.destroy()
        if (hlsRef.current === localHls) hlsRef.current = null
      }
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

  const syncAudio = useCallback(
    (play = false) => {
      void syncTrimAudio(videoRef.current, audioRef.current, play).catch((error: unknown) => {
        if (isAbortPlaybackError(error)) return
        setAudioError(tr.audioPlayFailed)
      })
    },
    [tr.audioPlayFailed],
  )

  const seekVideo = useCallback(
    (seconds: number) => {
      if (effectiveIsLive) return
      const clamped = clampSeconds(seconds, 0, safeDuration)
      requestedSeek.current = clamped
      setCurrentTime(clamped)
      seekPreview(videoRef.current, clamped)
      seekPreview(audioRef.current, clamped)
    },
    [effectiveIsLive, safeDuration],
  )

  const emitChange = useCallback(
    (nextStart: number, nextEnd: number) => {
      const range = buildRange(nextStart, nextEnd)
      lastEmittedRef.current = { start: range.startTime, end: range.endTime }
      onChange?.(range)
    },
    [onChange],
  )

  const updateStart = useCallback(
    (value: number, shouldSeek = true) => {
      if (effectiveIsLive) return
      const nextStart = clampSeconds(value, 0, Math.max(0, endSeconds - MIN_CLIP_SECONDS))
      setStartSeconds(nextStart)
      if (shouldSeek) seekVideo(nextStart)
      emitChange(nextStart, endSeconds)
    },
    [effectiveIsLive, endSeconds, seekVideo, emitChange],
  )

  const updateEnd = useCallback(
    (value: number, shouldSeek = true) => {
      if (effectiveIsLive) return
      const nextEnd = clampSeconds(
        value,
        Math.min(safeDuration, startSeconds + MIN_CLIP_SECONDS),
        safeDuration,
      )
      setEndSeconds(nextEnd)
      if (shouldSeek) seekVideo(nextEnd)
      emitChange(startSeconds, nextEnd)
    },
    [effectiveIsLive, safeDuration, startSeconds, seekVideo, emitChange],
  )

  const updateLiveDuration = useCallback(
    (seconds: number) => {
      const next = clampSeconds(Math.round(seconds), 5, 21600)
      setLiveClipSeconds(next)
      onChange?.(buildRange(0, next))
    },
    [onChange],
  )

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video || !streamUrl || streamError) return
    if (video.paused) {
      if (
        !effectiveIsLive &&
        loopSelection &&
        (video.currentTime < startSeconds || video.currentTime >= endSeconds - 0.05)
      ) {
        seekVideo(startSeconds)
      }
      setAudioError(null)
      void video
        .play()
        .then(() => {
          syncAudio(true)
        })
        .catch(() => {})
      // Start adaptive audio inside the user click gesture when video is already buffered.
      if (audioRef.current?.getAttribute('src') && video.readyState >= 3) {
        syncAudio(true)
      }
    } else {
      video.pause()
      syncAudio(false)
    }
  }, [
    streamUrl,
    streamError,
    effectiveIsLive,
    loopSelection,
    startSeconds,
    endSeconds,
    seekVideo,
    syncAudio,
  ])

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

  const handleVolumeChange = useCallback(
    (nextVolume: number) => {
      const clamped = clampSeconds(nextVolume, 0, 1)
      if (clamped > 0) lastNonZeroVolume.current = clamped
      setVolume(clamped)
      setMuted(clamped === 0)
      applyTrimAudioControls(
        videoRef.current,
        audioRef.current,
        clamped,
        clamped === 0,
        playbackRate,
      )
    },
    [playbackRate],
  )

  const handleRateChange = useCallback(
    (nextRate: number) => {
      setPlaybackRate(nextRate)
      applyTrimAudioControls(videoRef.current, audioRef.current, volume, muted, nextRate)
    },
    [volume, muted],
  )

  const toggleLoopPreview = useCallback(() => {
    const next = !loopSelection
    setLoopSelection(next)
    if (next && !effectiveIsLive) {
      seekVideo(startSeconds)
      setAudioError(null)
      const video = videoRef.current
      if (video) {
        void video
          .play()
          .then(() => {
            syncAudio(true)
          })
          .catch(() => {})
        if (audioRef.current?.getAttribute('src') && video.readyState >= 3) {
          syncAudio(true)
        }
      }
    }
  }, [loopSelection, effectiveIsLive, seekVideo, startSeconds, syncAudio])

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

  const changeZoom = useCallback(
    (nextZoom: number, focusTime?: number) => {
      if (safeDuration <= 0) return
      const clampedZoom = clampSeconds(nextZoom, 1, 64)
      const center = focusTime ?? (startSeconds + endSeconds) / 2
      const nextSpan = safeDuration / clampedZoom
      const nextStart = clampSeconds(center - nextSpan / 2, 0, Math.max(0, safeDuration - nextSpan))
      setZoom(clampedZoom)
      setViewStart(nextStart)
    },
    [safeDuration, startSeconds, endSeconds],
  )

  const zoomToSelection = useCallback(() => {
    if (safeDuration <= 0) return
    const clipLen = Math.max(MIN_CLIP_SECONDS, endSeconds - startSeconds)
    const targetZoom = clampSeconds(safeDuration / (clipLen * 1.35), 1, 64)
    changeZoom(targetZoom, (startSeconds + endSeconds) / 2)
  }, [safeDuration, startSeconds, endSeconds, changeZoom])

  const pointerToTime = useCallback(
    (clientX: number): number => {
      const el = trackRef.current
      if (!el || viewport.viewDuration <= 0) return 0
      const rect = el.getBoundingClientRect()
      const ratio = clampSeconds((clientX - rect.left) / Math.max(1, rect.width), 0, 1)
      return viewport.viewStart + ratio * viewport.viewDuration
    },
    [viewport.viewStart, viewport.viewDuration],
  )

  useEffect(() => {
    if (!activeDrag || effectiveIsLive) return
    const onPointerMove = (event: PointerEvent) => {
      const el = trackRef.current
      if (!el || viewport.viewDuration <= 0) return
      const rect = el.getBoundingClientRect()
      const deltaSeconds =
        ((event.clientX - activeDrag.originX) / Math.max(1, rect.width)) * viewport.viewDuration

      if (activeDrag.kind === 'start') {
        const currentEnd = endSecondsRef.current
        const next = clampSeconds(
          activeDrag.originStart + deltaSeconds,
          0,
          Math.max(0, currentEnd - MIN_CLIP_SECONDS),
        )
        setStartSeconds(next)
        seekVideo(next)
        emitChange(next, currentEnd)
      } else if (activeDrag.kind === 'end') {
        const currentStart = startSecondsRef.current
        const next = clampSeconds(
          activeDrag.originEnd + deltaSeconds,
          Math.min(safeDuration, currentStart + MIN_CLIP_SECONDS),
          safeDuration,
        )
        setEndSeconds(next)
        seekVideo(next)
        emitChange(currentStart, next)
      } else if (activeDrag.kind === 'move') {
        const length = activeDrag.originEnd - activeDrag.originStart
        const nextStart = clampSeconds(
          activeDrag.originStart + deltaSeconds,
          0,
          Math.max(0, safeDuration - length),
        )
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
  }, [
    activeDrag,
    effectiveIsLive,
    viewport.viewDuration,
    safeDuration,
    seekVideo,
    emitChange,
    pointerToTime,
  ])

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
  const effectiveVolume = muted ? 0 : volume

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
          <span>{tr.title}</span>
          {effectiveIsLive && (
            <span className="advanced-trimmer__live-pill" role="status">
              <Radio size={12} aria-hidden="true" />
              <span>{tr.live}</span>
            </span>
          )}
          {!effectiveIsLive && safeDuration >= 1800 && (
            <span className="advanced-trimmer__fast-pill">{tr.fastSectionCut}</span>
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

      <div
        ref={playerShellRef}
        className={`advanced-trimmer__player-shell${isFullscreen ? ' is-fullscreen' : ''}`}
      >
        <div className="advanced-trimmer__video-wrap">
          {isResolvingStream && (
            <div className="advanced-trimmer__loading-overlay">
              <Loader size={28} className="advanced-trimmer__spinner" aria-hidden="true" />
              <span>{tr.preparingPreview}</span>
            </div>
          )}
          {(streamError || audioError) && (
            <div className="advanced-trimmer__notice advanced-trimmer__notice--warn" role="status">
              <AlertCircle size={15} aria-hidden="true" />
              <span>
                {streamError
                  ? formatMessage(tr.previewUnavailable, { error: streamError })
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
            onRateChange={event => {
              setPlaybackRate(event.currentTarget.playbackRate)
              syncAudio(!event.currentTarget.paused)
            }}
            onTimeUpdate={event => {
              const now = event.currentTarget.currentTime
              if (Number.isFinite(now)) {
                setCurrentTime(now)
                if (!effectiveIsLive && loopSelection && now >= endSeconds) {
                  seekVideo(startSeconds)
                }
              }
              syncAudio(!event.currentTarget.paused)
            }}
            onVolumeChange={event => {
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
            onError={event => {
              if (isHlsActive || !streamUrl || event.currentTarget.currentSrc !== streamUrl) return
              previewRef.current?.fail(videoFailure(event.currentTarget))
            }}
            onLoadedMetadata={event => {
              if (!isHlsActive && event.currentTarget.currentSrc !== streamUrl) return
              applyTrimAudioControls(
                event.currentTarget,
                audioRef.current,
                volume,
                muted,
                playbackRate,
              )
              const mediaDur = event.currentTarget.duration
              if (
                !effectiveIsLive &&
                Number.isFinite(mediaDur) &&
                Math.abs(mediaDur - safeDuration) > 1
              ) {
                console.warn(
                  '[Visual Trim] Preview duration differs from analyzed duration:',
                  mediaDur,
                  safeDuration,
                )
              }
              if (!effectiveIsLive) {
                seekPreview(event.currentTarget, requestedSeek.current)
                seekPreview(audioRef.current, requestedSeek.current)
              }
            }}
          />

          <audio
            ref={audioRef}
            data-trim-audio
            src={audioUrl ?? undefined}
            preload="auto"
            hidden
            onLoadedMetadata={event => {
              applyTrimAudioControls(
                videoRef.current,
                event.currentTarget,
                volume,
                muted,
                playbackRate,
              )
              if (!effectiveIsLive) {
                const targetTime =
                  videoRef.current && videoRef.current.readyState >= 1
                    ? videoRef.current.currentTime
                    : requestedSeek.current
                seekPreview(event.currentTarget, targetTime)
              }
              syncAudio(!videoRef.current?.paused)
            }}
            onCanPlay={() => {
              syncAudio(!videoRef.current?.paused)
            }}
            onSeeked={() => {
              syncAudio(!videoRef.current?.paused)
            }}
            onPlaying={() => {
              setAudioError(null)
            }}
            onError={() => {
              if (audioUrl) setAudioError(tr.audioUnavailable)
            }}
          />
        </div>

        <TrimmerControls
          tr={tr}
          streamUrl={streamUrl}
          streamError={streamError}
          effectiveIsLive={effectiveIsLive}
          isPlaying={isPlaying}
          loopSelection={loopSelection}
          effectiveVolume={effectiveVolume}
          currentTime={currentTime}
          safeDuration={safeDuration}
          playbackRate={playbackRate}
          isFullscreen={isFullscreen}
          onTogglePlay={togglePlay}
          onSeekVideo={seekVideo}
          onToggleLoop={toggleLoopPreview}
          onToggleMute={toggleMute}
          onVolumeChange={handleVolumeChange}
          onRateChange={handleRateChange}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>

      {effectiveIsLive ? (
        <TrimmerLivePanel
          tr={tr}
          liveClipSeconds={liveClipSeconds}
          liveDraft={liveDraft}
          onLiveDraftChange={setLiveDraft}
          onCommitLiveDraft={commitLiveDraft}
          onUpdateLiveDuration={updateLiveDuration}
        />
      ) : (
        <>
          <TrimmerTimeline
            tr={tr}
            trackRef={trackRef}
            safeDuration={safeDuration}
            startSeconds={startSeconds}
            endSeconds={endSeconds}
            clipDurationSeconds={clipDurationSeconds}
            zoom={zoom}
            viewport={viewport}
            rulerTicks={rulerTicks}
            activeDrag={activeDrag}
            startPct={startPct}
            endPct={endPct}
            playheadPct={playheadPct}
            playheadVisible={playheadVisible}
            onChangeZoom={changeZoom}
            onZoomToSelection={zoomToSelection}
            onResetZoom={() => {
              setZoom(1)
              setViewStart(0)
            }}
            onSetViewStart={setViewStart}
            onSetActiveDrag={setActiveDrag}
            onSeekVideo={seekVideo}
            onPointerToTime={pointerToTime}
            onUpdateStart={updateStart}
            onUpdateEnd={updateEnd}
          />

          <TrimmerPrecisionPanel tr={tr} trimMode={trimMode} onTrimModeChange={onTrimModeChange} />
        </>
      )}

      <div className="advanced-trimmer__footer">
        <div className="advanced-trimmer__footer-main">
          <button className="advanced-trimmer__ghost-btn" type="button" onClick={handleReset}>
            <RotateCcw size={15} aria-hidden="true" />
            <span>{tr.reset}</span>
          </button>
          <span className="advanced-trimmer__shortcuts-hint">
            {effectiveIsLive ? tr.shortcutsLive : tr.shortcutsVod}
          </span>
        </div>
        <button
          className="advanced-trimmer__save-btn"
          type="button"
          onClick={() => onConfirm(currentRange)}
        >
          <Check size={16} aria-hidden="true" />
          <span>{tr.saveTrim}</span>
        </button>
      </div>
    </div>
  )
}

export default AdvancedTrimmer
