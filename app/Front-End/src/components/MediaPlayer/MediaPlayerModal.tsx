import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VideoPlayerView } from './VideoPlayerView';
import { AudioPlayerView } from './AudioPlayerView';
import { buildMediaUrl, useMediaEndpoint } from '../../lib/mediaEndpoint';
import { clearMediaCanvas, releaseAudioGraph, releaseMediaElement, stopPlayerFrame } from './mediaSession';
import { markAudioContext, markMediaSession } from './mediaDiagnostics';
import './MediaPlayer.css';
import type { SubtitlePreview } from '../../../../Shared/localSubtitles';

interface MediaPlayerModalProps {
  isOpen: boolean;
  filePath: string;
  title?: string;
  subtitlePreview?: SubtitlePreview;
  onClose: () => void;
  dir?: 'ltr' | 'rtl';
}

type MediaType = 'video' | 'audio' | 'unknown';

function getMediaType(filePath: string): MediaType {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'ogv', 'm4v'];
  const audioExts = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus', 'wma'];
  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  return 'unknown';
}

export default function MediaPlayerModal({ isOpen, filePath, title, subtitlePreview, onClose, dir = 'ltr' }: MediaPlayerModalProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [currentTheme, setCurrentTheme] = useState('midnight');
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem('cortexdl_media_volume');
    if (saved !== null) {
      const val = parseFloat(saved);
      if (!isNaN(val) && val >= 0 && val <= 1) return val;
    }
    return 1;
  });
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    return localStorage.getItem('cortexdl_media_muted') === 'true';
  });
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isIdle, setIsIdle] = useState(false);
  const [safeMode, setSafeMode] = useState(false);
  useEffect(() => { void window.cortexDl.getBuildInfo?.().then(info => setSafeMode(info.safeMode)); }, []);
  const mediaEndpoint = useMediaEndpoint();

  useEffect(() => {
    localStorage.setItem('cortexdl_media_volume', volume.toString());
  }, [volume]);

  useEffect(() => {
    localStorage.setItem('cortexdl_media_muted', isMuted.toString());
  }, [isMuted]);

  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ambilightRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioCleanupRef = useRef<(() => Promise<void>) | null>(null);
  const stopAmbilightRef = useRef<(() => void) | null>(null);
  const sessionClosedRef = useRef(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const effectGenerationRef = useRef(0);

  const mediaType = getMediaType(filePath);
  const fileUrl = buildMediaUrl(filePath, mediaEndpoint, { session: sessionIdRef.current });
  const displayTitle = title || '';

  const isMiniModeRef = useRef(isMiniMode);
  useEffect(() => {
    isMiniModeRef.current = isMiniMode;
  }, [isMiniMode]);

  const toggleMiniMode = () => setIsMiniMode(prev => !prev);

  const toggleTheme = () => {
    const themes = ['midnight', 'crimson', 'emerald', 'onyx'];
    setCurrentTheme(prev => {
      const idx = themes.indexOf(prev);
      return themes[(idx + 1) % themes.length];
    });
  };


  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const startHideTimer = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setShowControls(false);
      setIsIdle(true);
      setShowSettings(false);
    }, 2000);
  }, [clearHideTimer]);



  useEffect(() => {
    if (!isOpen || mediaType !== 'audio' || safeMode) return;

    const audioEl = audioRef.current;
    const canvas = canvasRef.current;
    if (!audioEl || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (audioContextRef.current || sessionClosedRef.current) return;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode;
    let source: MediaElementAudioSourceNode;
    let rafId: number | null = null;

    try {
      const AudioCtxCtor = window.AudioContext || (window as any).webkitAudioContext;
      audioCtx = new AudioCtxCtor();
      source = audioCtx.createMediaElementSource(audioEl);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch (e) {
      console.warn('[Visualizer] Web Audio setup failed:', e);
      if (audioCtx) void audioCtx.close().catch(() => {});
      return;
    }

    audioContextRef.current = audioCtx;
    markAudioContext(true);
    analyserRef.current = analyser;
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (sessionClosedRef.current) return;
      rafId = requestAnimationFrame(draw);
      animationFrameRef.current = rafId;

      if (isMiniModeRef.current) return;

      analyser.getByteFrequencyData(dataArray);

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const barCount = 64;
      const gap = 3;
      const barW = Math.max((W - gap * (barCount - 1)) / barCount, 2);
      const step = Math.floor(bufferLength / barCount);

      ctx.lineCap = 'round';
      ctx.lineWidth = barW;

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step];
        const barH = (value / 255) * (H * 0.88);
        if (barH < 2) continue;

        const x = i * (barW + gap) + barW / 2;

        const grad = ctx.createLinearGradient(x, H, x, H - barH);
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.95)');
        grad.addColorStop(0.5, 'rgba(99, 102, 241, 0.88)');
        grad.addColorStop(1, 'rgba(167, 139, 250, 0.78)');

        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, H);
        ctx.lineTo(x, H - barH);
        ctx.stroke();

        if (value > 185) {
          ctx.beginPath();
          ctx.moveTo(x, H);
          ctx.lineTo(x, H - barH);
          ctx.stroke();
        }
      }
    };

    draw();

    let cleaned = false;
    audioCleanupRef.current = async () => {
      if (cleaned) return;
      cleaned = true;
      stopPlayerFrame(rafId);
      animationFrameRef.current = null;

      audioContextRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
      audioCleanupRef.current = null;
      clearMediaCanvas(canvas);
      await releaseAudioGraph(audioCtx, source, analyser);
      markAudioContext(false);
    };
  }, [safeMode, isOpen, mediaType, filePath]);

  const togglePlay = useCallback(() => {
    if (!mediaRef.current || sessionClosedRef.current) return;
    if (isPlaying) {
      mediaRef.current.pause();
    } else {
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      mediaRef.current.play().catch(error => {
        if (error?.name !== 'AbortError' && !sessionClosedRef.current) console.error(error);
      });
    }
    setIsPlaying(p => !p);
  }, [isPlaying]);

  const releasePlayerSession = useCallback((captured?: {
    video: HTMLVideoElement | null;
    audio: HTMLAudioElement | null;
    ambilight: HTMLCanvasElement | null;
    visualizer: HTMLCanvasElement | null;
  }): Promise<void> => {
    if (sessionClosedRef.current) return Promise.resolve();
    sessionClosedRef.current = true;
    const video = captured?.video ?? videoRef.current;
    const audio = captured?.audio ?? audioRef.current;
    clearHideTimer();
    stopAmbilightRef.current?.();
    stopAmbilightRef.current = null;
    stopPlayerFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
    if (document.fullscreenElement === containerRef.current) void document.exitFullscreen().catch(() => {});
    const audioClose = audioCleanupRef.current?.() ?? Promise.resolve();
    releaseMediaElement(video);
    releaseMediaElement(audio);
    clearMediaCanvas(captured?.ambilight ?? ambilightRef.current);
    clearMediaCanvas(captured?.visualizer ?? canvasRef.current);
    mediaRef.current = null;
    markMediaSession(sessionIdRef.current, false);
    void window.cortexDl.closeMediaSession(sessionIdRef.current).catch(() => {});
    return audioClose;
  }, [clearHideTimer]);

  const handleClose = useCallback(() => {
    void releasePlayerSession();
    onClose();
  }, [releasePlayerSession, onClose]);


  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          isFullscreen ? document.exitFullscreen?.() : handleClose();
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          if (mediaRef.current) mediaRef.current.currentTime -= 5;
          break;
        case 'ArrowRight':
          if (mediaRef.current) mediaRef.current.currentTime += 5;
          break;
        case 'ArrowUp':
          setVolume(v => Math.min(1, v + 0.1));
          break;
        case 'ArrowDown':
          setVolume(v => Math.max(0, v - 0.1));
          break;
        case 'm':
          setIsMuted(m => !m);
          break;
        case 'f':
          if (mediaType === 'video') toggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);

  }, [handleClose, isFullscreen, isOpen, mediaType, togglePlay]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);


  useEffect(() => {
    markMediaSession(sessionIdRef.current, true);
    const generationRef = effectGenerationRef;
    const generation = ++generationRef.current;
    const captured = {
      video: videoRef.current,
      audio: audioRef.current,
      ambilight: ambilightRef.current,
      visualizer: canvasRef.current,
    };
    return () => {
      // React StrictMode replays effects without removing the DOM. The next
      // setup invalidates this microtask; a real unmount releases the session.
      queueMicrotask(() => {
        if (generationRef.current === generation) void releasePlayerSession(captured);
      });
    };
  }, [releasePlayerSession]);


  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLeavePiP = () => {
      setIsMiniMode(false);
      if (!sessionClosedRef.current && window.cortexDl?.showMainWindow) {
        window.cortexDl.showMainWindow().catch(console.error);
      }
    };

    video.addEventListener('leavepictureinpicture', handleLeavePiP);
    return () => video.removeEventListener('leavepictureinpicture', handleLeavePiP);
  }, [isOpen, mediaType]);

  useEffect(() => {
    mediaRef.current = mediaType === 'video' ? videoRef.current : audioRef.current;
  }, [mediaType, filePath, isOpen]);

  useEffect(() => {
    const el = mediaRef.current || (mediaType === 'video' ? videoRef.current : audioRef.current);
    if (el) {
      el.volume = isMuted ? 0 : volume;
      el.playbackRate = playbackSpeed;
    }
  }, [volume, isMuted, playbackSpeed, filePath, isOpen, mediaType, isPlaying]);

  useEffect(() => {
    clearHideTimer();
    startHideTimer();
  }, [isPlaying, clearHideTimer, startHideTimer]);


  useEffect(() => {
    if (mediaType !== 'video' || safeMode) return;

    let rafId: number | null = null;
    let isActive = true;

    let lastTime = 0;
    const fpsLimit = 1000 / 15;

    const drawAmbilightFrame = (timestamp: number) => {
      if (!isActive) return;

      if (timestamp - lastTime >= fpsLimit) {
        const video = videoRef.current;
        const canvas = ambilightRef.current;

        if (video && canvas && !video.paused && !video.ended) {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            if (canvas.width !== 160) {
              canvas.width = 160;
              canvas.height = Math.round((160 * video.videoHeight) / video.videoWidth);
            }
            const ctx = canvas.getContext('2d');
            if (ctx) {



              if (video.videoWidth <= 2560) {
                try {
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                } catch (_) { /* Keep the previous frame if drawing fails. */ }
              }
            }
          }
        }
        lastTime = timestamp;
      }

      if (isActive) {
        rafId = requestAnimationFrame(drawAmbilightFrame);
      }
    };

    if (isPlaying) {
      rafId = requestAnimationFrame(drawAmbilightFrame);
    }

    const stop = () => {
      isActive = false;
      stopPlayerFrame(rafId);
    };
    stopAmbilightRef.current = stop;
    return () => {
      stop();
      if (stopAmbilightRef.current === stop) stopAmbilightRef.current = null;
    };
  }, [safeMode, isPlaying, mediaType]);



  const handleTimeUpdate = () => {

  };

  const handleLoadedMetadata = () => {
    const el = mediaRef.current || (mediaType === 'video' ? videoRef.current : audioRef.current);
    if (el) {
      setDuration(el.duration);
      el.volume = isMuted ? 0 : volume;
      el.playbackRate = playbackSpeed;
    }
  };

  const handleSeek = (time: number) => {
    if (mediaRef.current) {
      mediaRef.current.currentTime = time;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    setIsMuted(vol === 0);
  };

  const toggleMute = () => setIsMuted(m => !m);

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    setShowSettings(false);
  };

  const toggleSettings = () => setShowSettings(!showSettings);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    document.fullscreenElement ? document.exitFullscreen() : containerRef.current.requestFullscreen();
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn("PiP not supported or failed to start", err);
    }
  };

  const handleMouseMove = () => {
    clearHideTimer();
    setShowControls(true);
    setIsIdle(false);
    startHideTimer();
  };

  const handleMouseLeave = () => {
    clearHideTimer();
    setShowControls(false);
    setIsIdle(true);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    if (mediaRef.current) mediaRef.current.currentTime = 0;
  };

  if (!isOpen) return null;

  return (
    <div
      className={`media-player-overlay ${isMiniMode ? 'mini-mode-overlay' : ''}`}
      onClick={e => { if (e.target === e.currentTarget && !isMiniMode) handleClose() }}
      dir={dir}
    >
      <div
        ref={containerRef}
        className={`media-player-container ${mediaType} ${isIdle && !isMiniMode ? 'idle-hide' : ''} ${isMiniMode ? 'mini-mode-container' : ''}`}
        onMouseMove={isMiniMode ? undefined : handleMouseMove}
        onMouseLeave={isMiniMode ? undefined : handleMouseLeave}
      >
        {mediaType === 'video' && (
          <VideoPlayerView
            mediaEndpoint={mediaEndpoint}
            sessionId={sessionIdRef.current}
            fileUrl={fileUrl}
            title={displayTitle}
            filePath={filePath}
            subtitlePreview={subtitlePreview}
            isPlaying={isPlaying}
            duration={duration}
            volume={volume}
            isMuted={isMuted}
            playbackSpeed={playbackSpeed}
            showSettings={showSettings}
            isFullscreen={isFullscreen}
            showControls={showControls}
            videoRef={videoRef}
            mediaRef={mediaRef}
            ambilightRef={ambilightRef}
            togglePlay={togglePlay}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeChange}
            toggleMute={toggleMute}
            onSpeedChange={handleSpeedChange}
            toggleSettings={toggleSettings}
            toggleFullscreen={toggleFullscreen}
            togglePiP={togglePiP}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleEnded}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onClose={handleClose}
          />
        )}

        {mediaType === 'audio' && (
          <AudioPlayerView
            fileUrl={fileUrl}
            title={displayTitle}
            isPlaying={isPlaying}
            duration={duration}
            volume={volume}
            isMuted={isMuted}
            playbackSpeed={playbackSpeed}
            showSettings={showSettings}
            showControls={showControls}
            audioRef={audioRef}
            mediaRef={mediaRef}
            canvasRef={canvasRef}
            togglePlay={togglePlay}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeChange}
            toggleMute={toggleMute}
            onSpeedChange={handleSpeedChange}
            toggleSettings={toggleSettings}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleEnded}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onClose={handleClose}
            isMiniMode={isMiniMode}
            toggleMiniMode={toggleMiniMode}
            currentTheme={currentTheme}
            toggleTheme={toggleTheme}
          />
        )}

        {mediaType === 'unknown' && (
          <div className="unsupported-media" style={{ color: 'white', textAlign: 'center', marginTop: '20%' }}>
            <p>Unsupported file format</p>
          </div>
        )}
      </div>
    </div>
  );
}
