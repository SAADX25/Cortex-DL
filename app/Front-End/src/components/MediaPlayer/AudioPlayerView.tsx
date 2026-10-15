import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { PlayerControls } from './PlayerControls';
import { PlayerHeader } from './PlayerHeader';
import { Play, Pause, Maximize, Volume2, VolumeX, X } from 'lucide-react';
import { useLang } from '../../stores/useSettingsStore';

interface AudioViewProps {
  fileUrl: string;
  title: string;
  isPlaying: boolean;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackSpeed: number;
  showSettings: boolean;
  showControls: boolean;
  audioRef: React.RefObject<HTMLAudioElement>;
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  togglePlay: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  toggleMute: () => void;
  onSpeedChange: (speed: number) => void;
  toggleSettings: () => void;
  onTimeUpdate: () => void;
  onLoadedMetadata: () => void;
  onEnded: () => void;
  onPlay: () => void;
  onPause: () => void;
  onClose: () => void;
  isMiniMode?: boolean;
  toggleMiniMode?: () => void;
  currentTheme?: string;
  toggleTheme?: () => void;
  artworkControl?: React.ReactNode;
  coverImage?: string | null;
}

export function AudioPlayerView({
  fileUrl, title, isPlaying, duration, volume, isMuted, playbackSpeed, showSettings, showControls,
  audioRef, mediaRef, canvasRef,
  togglePlay, onSeek, onVolumeChange, toggleMute, onSpeedChange, toggleSettings,
  onTimeUpdate, onLoadedMetadata, onEnded, onPlay, onPause, onClose,
  isMiniMode, toggleMiniMode, currentTheme = 'midnight', toggleTheme, artworkControl, coverImage
}: AudioViewProps) {
  const [hasError, setHasError] = React.useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const lang = useLang();
  const labels = lang === 'ar'
    ? { play: 'تشغيل', pause: 'إيقاف مؤقت', mute: 'كتم الصوت', unmute: 'إلغاء كتم الصوت', volume: 'مستوى الصوت', expand: 'توسيع المشغل', close: 'إغلاق المشغل', mini: 'مشغل صوت مصغّر' }
    : { play: 'Play', pause: 'Pause', mute: 'Mute', unmute: 'Unmute', volume: 'Volume', expand: 'Expand player', close: 'Close player', mini: 'Mini audio player' };
  const wrapperRef = useRef<HTMLDivElement>(null);
  const recordRef = useRef<HTMLDivElement>(null);
  const previousRecord = useRef<DOMRect | null>(null);
  const animations = useRef<Animation[]>([]);
  const closingRef = useRef(false);
  const cancelAnimations = useCallback(() => { animations.current.forEach(animation => animation.cancel()); animations.current = []; }, []);
  const changeMode = () => {
    if (closingRef.current) return;
    previousRecord.current = recordRef.current?.getBoundingClientRect() ?? null;
    cancelAnimations();
    toggleMiniMode?.();
  };

  useLayoutEffect(() => {
    cancelAnimations();
    const before = previousRecord.current;
    previousRecord.current = null;
    const record = recordRef.current, wrapper = wrapperRef.current;
    if (before && record && wrapper && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const after = record.getBoundingClientRect();
      if (before.width && after.width) {
        const x = before.left + before.width / 2 - after.left - after.width / 2;
        const y = before.top + before.height / 2 - after.top - after.height / 2;
        animations.current.push(record.animate([
          { transform: `translate(${x}px, ${y}px) scale(${before.width / after.width})` },
          { transform: 'translate(0, 0) scale(1)' },
        ], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }));
      }
      const controls = wrapper.querySelector(isMiniMode ? '.mini-player-controls' : '.player-footer');
      if (controls) animations.current.push(controls.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 80, fill: 'backwards', easing: 'ease-out' }));
    }
    return cancelAnimations;
  }, [isMiniMode, cancelAnimations]);

  const closeMini = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    audioRef.current?.pause();
    setIsClosing(true);
    cancelAnimations();
    if (!wrapperRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    const animation = wrapperRef.current.animate([{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(10px) scale(0.96)' }], { duration: 140, fill: 'forwards', easing: 'ease-in' });
    animations.current.push(animation);
    void animation.finished.then(onClose).catch(() => {});
  };

  return (
    <div ref={wrapperRef} className={`audio-view-wrapper ${isMiniMode ? 'mini-mode' : 'fullscreen-mode'} ${isClosing ? 'is-closing' : ''}`}>
      <audio
        ref={audioRef}
        src={fileUrl || undefined}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={() => { setHasError(false); onLoadedMetadata(); }}
        onEnded={onEnded}
        onPlay={() => { setHasError(false); onPlay(); }}
        onPause={onPause}
        onError={() => setHasError(true)}
        crossOrigin="anonymous"
      />

      <PlayerHeader title={title} visible={showControls} onClose={onClose} />

      <div className={`audio-player-body theme-${currentTheme}`}>
        <div className={`audio-ambient-bg ${isPlaying ? 'active' : ''}`} />
        {hasError ? (
          <div style={{ color: '#f87171', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span style={{ fontSize: '15px', fontWeight: 600 }}>Unable to play audio file</span>
          </div>
        ) : (
          <div className="audio-center-stage">
            <div ref={recordRef} className="audio-record-motion">
            <div className="vinyl-record">
              {coverImage && <img className="audio-cover-image" src={coverImage} alt="" />}
              <div className="vinyl-groove vinyl-groove-1" />
              <div className="vinyl-groove vinyl-groove-2" />
              <div className="vinyl-groove vinyl-groove-3" />
              <div className="vinyl-groove vinyl-groove-4" />
              <div className="vinyl-label" />
            </div>
            </div>
          </div>
        )}
      </div>

      <div className="mini-player-controls" dir="ltr" role="group" aria-label={labels.mini}>
        <button className="mini-control-btn mini-play" disabled={isClosing} onClick={(e) => { e.stopPropagation(); togglePlay(); }} aria-label={isPlaying ? labels.pause : labels.play} title={isPlaying ? labels.pause : labels.play}>
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <div className="mini-volume-group">
          <button className="mini-control-btn mini-mute" disabled={isClosing} onClick={toggleMute} aria-label={isMuted || volume === 0 ? labels.unmute : labels.mute} aria-pressed={isMuted || volume === 0} title={isMuted || volume === 0 ? labels.unmute : labels.mute}>
            {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input className="mini-volume-slider" type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} disabled={isClosing} onChange={onVolumeChange} aria-label={labels.volume} aria-valuetext={`${Math.round((isMuted ? 0 : volume) * 100)}%`} title={`${labels.volume}: ${Math.round((isMuted ? 0 : volume) * 100)}%`} style={{ '--volume': `${(isMuted ? 0 : volume) * 100}%` } as React.CSSProperties} />
        </div>
        <button className="mini-control-btn mini-expand" disabled={isClosing} onClick={(e) => { e.stopPropagation(); changeMode(); }} aria-label={labels.expand} title={labels.expand}>
          <Maximize size={20} />
        </button>
        <button className="mini-control-btn close" disabled={isClosing} onClick={(e) => { e.stopPropagation(); closeMini(); }} aria-label={labels.close} title={labels.close}>
          <X size={20} />
        </button>
      </div>

      <div className="audio-visualizer-strip">
        <canvas
          ref={canvasRef}
          className="audio-visualizer"
          width={800}
          height={80}
        />
      </div>

      <div
        className="player-footer"
        style={{
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? 'auto' : 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        <PlayerControls
          artworkControl={artworkControl}
          mediaRef={mediaRef}
          mediaType="audio"
          isPlaying={isPlaying}
          duration={duration}
          volume={volume}
          isMuted={isMuted}
          playbackSpeed={playbackSpeed}
          showSettings={showSettings}
          togglePlay={togglePlay}
          onSeek={onSeek}
          onVolumeChange={onVolumeChange}
          toggleMute={toggleMute}
          onSpeedChange={onSpeedChange}
          toggleSettings={toggleSettings}
          togglePiP={changeMode}
          currentTheme={currentTheme}
          onToggleTheme={toggleTheme}
        />
      </div>
    </div>
  );
}
