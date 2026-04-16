import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VideoPlayerView } from './VideoPlayerView';
import { AudioPlayerView } from './AudioPlayerView';
import './MediaPlayer.css';

interface MediaPlayerModalProps {
  isOpen: boolean;
  filePath: string;
  title?: string;
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

const DEFAULT_MEDIA_SERVER_PORT = 3345;

function toStreamUrl(filePath: string, port: number): string {
  if (!filePath) return '';
  return `http://127.0.0.1:${port}/?path=${encodeURIComponent(filePath)}`;
}

export default function MediaPlayerModal({ isOpen, filePath, title, onClose, dir = 'ltr' }: MediaPlayerModalProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [currentTheme, setCurrentTheme] = useState('midnight');
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isIdle, setIsIdle] = useState(false);
  const [mediaPort, setMediaPort] = useState(DEFAULT_MEDIA_SERVER_PORT);
  const [hideForPiP, setHideForPiP] = useState(false);

  useEffect(() => {
    if (window.cortexDl?.getMediaPort) {
      window.cortexDl.getMediaPort().then(setMediaPort).catch(() => {});
    }
  }, []);

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

  const mediaType = getMediaType(filePath);
  const fileUrl = toStreamUrl(filePath, mediaPort);
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

  // Reset states and perform cleanup when switching between files
  useEffect(() => {
    if (document.pictureInPictureElement) {
       document.exitPictureInPicture().catch(() => {});
    }

    setHideForPiP(false);
    setIsMiniMode(false);
    setIsPlaying(false);

    if (mediaRef.current) {
      mediaRef.current.pause();
      try { mediaRef.current.currentTime = 0; } catch (e) { /* ignore */ }
    }
    if (videoRef.current) videoRef.current.pause();
    if (audioRef.current) audioRef.current.pause();
  }, [filePath]);

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
      setShowSettings(false); // Close settings menu if idle
    }, 2000);
  }, [clearHideTimer]);

  // Audio Visualizer Logic

  useEffect(() => {
    if (!isOpen || mediaType !== 'audio') return;

    const audioEl = audioRef.current;
    const canvas = canvasRef.current;
    if (!audioEl || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let audioCtx: AudioContext;
    let analyser: AnalyserNode;
    let source: MediaElementAudioSourceNode;
    let rafId: number;

    try {
      const cached = (audioEl as HTMLAudioElement & { __audioCache?: { ctx: AudioContext; source: MediaElementAudioSourceNode } }).__audioCache;
      if (cached && cached.ctx.state !== 'closed') {
        audioCtx = cached.ctx;
        source = cached.source;
      } else {
        const AudioCtxCtor = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioCtxCtor();
        source = audioCtx.createMediaElementSource(audioEl);
        (audioEl as HTMLAudioElement & { __audioCache?: { ctx: AudioContext; source: MediaElementAudioSourceNode } }).__audioCache = { ctx: audioCtx, source };
      }
      
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch (e) {
      console.warn('[Visualizer] Web Audio setup failed:', e);
      return;
    }

    audioContextRef.current = audioCtx;
    analyserRef.current = analyser;
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
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

    return () => {
      cancelAnimationFrame(rafId);
      animationFrameRef.current = null;
      try { if (source && analyser) source.disconnect(analyser); } catch (_) { /* ignore */ }
      try { if (analyser) analyser.disconnect(); } catch (_) { /* ignore */ }
      
      audioContextRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, [isOpen, mediaType, filePath]);

  /* ── Keyboard Shortcuts ── */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isFullscreen, onClose, mediaType]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  /* ── Cleanup on Close ── */
  useEffect(() => {
    if (!isOpen) {
      const release = (el: HTMLVideoElement | HTMLAudioElement | HTMLCanvasElement | null) => {
        if (!el) return;
        if ('pause' in el) {
          el.pause();
          el.removeAttribute('src');
          el.load();
        } else if (el.tagName === 'CANVAS') {
          const ctx = (el as HTMLCanvasElement).getContext('2d');
          ctx?.clearRect(0, 0, el.width, el.height);
        }
      };
      release(videoRef.current);
      release(audioRef.current);
      release(ambilightRef.current);

      setIsPlaying(false);
      setDuration(0);
      clearHideTimer();
      setShowControls(true);
      setIsIdle(false);
      setPlaybackSpeed(1);
      setIsMiniMode(false);
      setHideForPiP(false);
    }
  }, [isOpen, clearHideTimer]);

  /* ── Force Cleanup on Unmount ── */
  /* ── Force Cleanup on Unmount ── */
  useEffect(() => {
    const mediaObj = mediaRef.current;
    const videoObj = videoRef.current;
    const audioObj = audioRef.current;
    
    return () => {
      const releaseStrict = (el: HTMLVideoElement | HTMLAudioElement | null) => {
        if (el && typeof el.pause === 'function') {
          el.pause();
          el.removeAttribute('src');
          el.load();
        }
      };
      releaseStrict(mediaObj);
      releaseStrict(videoObj);
      releaseStrict(audioObj);
    };
  }, []);

  /* ── Native PiP Sync ── */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    const handleLeavePiP = () => {
       setIsMiniMode(false);
       setHideForPiP(false);
       if (window.cortexDl?.showMainWindow) {
         window.cortexDl.showMainWindow().catch(console.error);
       }
    };
    
    video.addEventListener('leavepictureinpicture', handleLeavePiP);
    return () => video.removeEventListener('leavepictureinpicture', handleLeavePiP);
  }, [isOpen, mediaType]);

  useEffect(() => {
    mediaRef.current = mediaType === 'video' ? videoRef.current : audioRef.current;
  }, [mediaType]);

  useEffect(() => {
    if (mediaRef.current) {
      mediaRef.current.volume = isMuted ? 0 : volume;
      mediaRef.current.playbackRate = playbackSpeed;
    }
  }, [volume, isMuted, playbackSpeed]);

  useEffect(() => {
    clearHideTimer();
    startHideTimer();
  }, [isPlaying, clearHideTimer, startHideTimer]);

  /* ── Ambilight Loop ── */
  useEffect(() => {
    if (mediaType !== 'video') return;

    let rafId: number;
    let isActive = true;

    let lastTime = 0;
    const fpsLimit = 1000 / 15; // 15 FPS

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
              // PROFESSIONAL OPTIMIZATION: Skip canvas drawing for 4K/high-res videos.
              // Copying 4K video frames to Canvas is extremely CPU-intensive and causes
              // the 50% CPU spikes. We disable the effect for video wider than 2560px.
              if (video.videoWidth <= 2560) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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

    return () => {
      isActive = false;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isPlaying, mediaType]);

  /* ── Action Handlers ── */

  const togglePlay = () => {
    if (!mediaRef.current) return;
    if (isPlaying) {
      mediaRef.current.pause();
    } else {
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      mediaRef.current.play().catch(console.error);
    }
    setIsPlaying(p => !p);
  };

  const handleTimeUpdate = () => {
    // Current time is now handled directly via ref in PlayerControls to prevent re-renders
  };

  const handleLoadedMetadata = () => {
    if (mediaRef.current) setDuration(mediaRef.current.duration);
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

  const handleClose = () => {
    if (mediaType === 'video' && document.pictureInPictureElement === videoRef.current) {
      setHideForPiP(true);
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`media-player-overlay ${isMiniMode ? 'mini-mode-overlay' : ''}`}
      onClick={e => { if (e.target === e.currentTarget && !isMiniMode) handleClose() }}
      style={hideForPiP ? { opacity: 0, pointerEvents: 'none' } : undefined}
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
            fileUrl={fileUrl}
            title={displayTitle}
            filePath={filePath}
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
