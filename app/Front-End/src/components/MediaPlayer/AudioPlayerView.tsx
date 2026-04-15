import React from 'react';
import { PlayerControls } from './PlayerControls';
import { Play, Pause, Maximize, X } from 'lucide-react';

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
}

export function AudioPlayerView({
  fileUrl, title, isPlaying, duration, volume, isMuted, playbackSpeed, showSettings, showControls,
  audioRef, mediaRef, canvasRef,
  togglePlay, onSeek, onVolumeChange, toggleMute, onSpeedChange, toggleSettings,
  onTimeUpdate, onLoadedMetadata, onEnded, onPlay, onPause, onClose,
  isMiniMode, toggleMiniMode
}: AudioViewProps) {
  return (
    <div className={`audio-view-wrapper ${isMiniMode ? 'mini-mode' : 'fullscreen-mode'}`}>
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

      {/* Mini Mode Controls */}
      <div className="mini-player-controls">
        <button className="mini-control-btn" onClick={togglePlay} title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button className="mini-control-btn" onClick={toggleMiniMode} title="Expand">
          <Maximize size={20} />
        </button>
        <button className="mini-control-btn close" onClick={onClose} title="Close">
          <X size={20} />
        </button>
      </div>

      <div
        className="player-header"
        style={{
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? 'auto' : 'none',
        }}
        onClick={e => e.stopPropagation()}
      >
        <span className="player-header-title">{title}</span>
        <div className="player-header-actions">
           <button className="media-player-close" onClick={onClose} title="Close (Esc)">
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
           </button>
        </div>
      </div>

      <div className="audio-player-body">
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
          {isMiniMode && <p className="audio-track-name audio-track-name-spaced">{title || 'Now Playing'}</p>}
        </div>
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
          togglePiP={toggleMiniMode}
        />
      </div>
    </div>
  );
}
