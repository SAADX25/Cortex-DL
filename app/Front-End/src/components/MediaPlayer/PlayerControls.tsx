import React, { useEffect, useRef } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings2, PictureInPicture, Palette } from 'lucide-react';
import { SubtitleMenu } from './SubtitleMenu';
import type { PlayerSubtitleTrack } from '../../../../Shared/types';
import { useLang } from '../../stores/useSettingsStore';

interface PlayerControlsProps {
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  isPlaying: boolean;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackSpeed: number;
  showSettings: boolean;
  mediaType: 'video' | 'audio';
  isFullscreen?: boolean;
  subtitles?: PlayerSubtitleTrack[];
  activeSubtitle?: number;
  onSubtitleChange?: (index: number) => void;
  onSubtitleMenuChange?: (open: boolean) => void;
  togglePlay: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  toggleMute: () => void;
  onSpeedChange: (speed: number) => void;
  toggleSettings: () => void;
  toggleFullscreen?: () => void;
  togglePiP?: () => void;
  isFloating?: boolean;
  floatingActions?: React.ReactNode;
  artworkControl?: React.ReactNode;
  currentTheme?: string;
  onToggleTheme?: () => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function PlayerControls({
  mediaRef, isPlaying, duration, volume, isMuted, playbackSpeed, showSettings, mediaType, isFullscreen, subtitles, activeSubtitle, onSubtitleChange, onSubtitleMenuChange,
  togglePlay, onSeek, onVolumeChange, toggleMute, onSpeedChange, toggleSettings, toggleFullscreen, togglePiP, isFloating, floatingActions, artworkControl, currentTheme, onToggleTheme
}: PlayerControlsProps) {
  const lang = useLang();
  const floatingLabel = isFloating ? (lang === 'ar' ? 'إرجاع المشغل' : 'Return player') : (lang === 'ar' ? 'مشغل عائم مع الترجمة' : 'Floating player with subtitles');
  const miniLabel = lang === 'ar' ? 'تصغير مشغل الصوت' : 'Minimize audio player';
  const progressRef = useRef<HTMLInputElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const updateTime = () => {
      const time = media.currentTime;
      if (progressRef.current) {
        progressRef.current.value = time.toString();
        const progress = duration > 0 ? (time / duration) * 100 : 0;
        progressRef.current.style.setProperty('--progress', `${progress}%`);
      }
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = `${formatTime(time)} / ${formatTime(duration)}`;
      }
    };

    media.addEventListener('timeupdate', updateTime);
    updateTime();

    return () => media.removeEventListener('timeupdate', updateTime);
  }, [mediaRef, duration]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(parseFloat(e.target.value));
  };

  return (
    <>
      <div className="progress-container">
        <input
          ref={progressRef}
          type="range"
          className="progress-slider"
          min={0}
          max={duration || 0}
          step={0.1}
          defaultValue={0}
          onChange={handleSeek}
        />
      </div>

      <div className="controls-row">
        <div className="controls-left">
          <button className="control-btn play-btn" onClick={togglePlay} title={isPlaying ? "Pause (Space)" : "Play (Space)"}>
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>

          <div className="volume-group">
             <button className="control-btn" onClick={toggleMute} title={isMuted ? "Unmute (m)" : "Mute (m)"}>
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
               title="Volume"
             />
          </div>

          <span className="time-display" ref={timeDisplayRef} dir="ltr">
            0:00 / {formatTime(duration)}
          </span>
        </div>

        <div className="controls-right">
          {artworkControl}
          <div className="settings-wrapper">
             <button className={`control-btn ${showSettings ? 'active' : ''}`} onClick={toggleSettings} title="Settings">
               <Settings2 size={20} />
             </button>
             {showSettings && (
               <div className="speed-menu">
                  {[0.5, 1, 1.5, 2].map((speed) => (
                    <button
                      key={speed}
                      className={`speed-option ${playbackSpeed === speed ? 'selected' : ''}`}
                      onClick={() => onSpeedChange(speed)}
                    >
                      {speed}x
                    </button>
                  ))}
               </div>
             )}
          </div>

          {mediaType === 'video' && subtitles && subtitles.length > 0 && onSubtitleChange && (
            <SubtitleMenu tracks={subtitles} active={activeSubtitle ?? -1} onChange={onSubtitleChange} onOpenChange={onSubtitleMenuChange} isFloating={isFloating} />
          )}

          {mediaType === 'audio' && onToggleTheme && (
            <button className="control-btn" onClick={onToggleTheme} title={`Theme: ${currentTheme}`}>
              <Palette size={20} />
            </button>
          )}

          {togglePiP && (
            <button className="control-btn player-floating-toggle" onClick={togglePiP} aria-pressed={!!isFloating} aria-label={mediaType === 'video' ? floatingLabel : miniLabel} title={mediaType === 'video' ? floatingLabel : miniLabel}>
              <PictureInPicture size={20} />
            </button>
          )}

          {mediaType === 'video' && toggleFullscreen && (
            <button className="control-btn" onClick={toggleFullscreen} title="Fullscreen (f)">
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          )}
          {isFloating && floatingActions}
        </div>
      </div>
    </>
  );
}
