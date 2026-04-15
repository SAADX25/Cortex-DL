import React, { useState } from 'react';
import { PlayerControls } from './PlayerControls';
import { MediaInfoOverlay } from './MediaInfoOverlay';

interface VideoViewProps {
  fileUrl: string;
  title: string;
  filePath: string;
  isPlaying: boolean;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackSpeed: number;
  showSettings: boolean;
  isFullscreen: boolean;
  showControls: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  ambilightRef: React.RefObject<HTMLCanvasElement>;
  togglePlay: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  toggleMute: () => void;
  onSpeedChange: (speed: number) => void;
  toggleSettings: () => void;
  toggleFullscreen: () => void;
  togglePiP: () => void;
  onTimeUpdate: () => void;
  onLoadedMetadata: () => void;
  onEnded: () => void;
  onPlay: () => void;
  onPause: () => void;
  onClose: () => void;
}

export function VideoPlayerView({
  fileUrl, title, filePath, isPlaying, duration, volume, isMuted, playbackSpeed, showSettings,
  isFullscreen, showControls, videoRef, mediaRef, ambilightRef,
  togglePlay, onSeek, onVolumeChange, toggleMute, onSpeedChange, toggleSettings, toggleFullscreen, togglePiP,
  onTimeUpdate, onLoadedMetadata, onEnded, onPlay, onPause, onClose
}: VideoViewProps) {
  const [isBuffering, setIsBuffering] = useState(false);
  const [showMediaInfo, setShowMediaInfo] = useState(false);

  return (
    <>
      <div className="player-body">
        <div className="video-wrapper">
          <canvas ref={ambilightRef} className="ambilight-video" />
          
          <video
            ref={videoRef}
            className="main-video"
            src={fileUrl}
            onClick={togglePlay}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onLoadedMetadata}
            onEnded={onEnded}
            onPlay={() => { setIsBuffering(false); onPlay(); }}
            onPause={onPause}
            onWaiting={() => setIsBuffering(true)}
            onPlaying={() => setIsBuffering(false)}
            onCanPlay={() => setIsBuffering(false)}
            crossOrigin="anonymous"
            playsInline
          />

          {isBuffering && (
            <div className="buffering-overlay">
               <div className="spinner-buffering"></div>
            </div>
          )}
        </div>
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
           <MediaInfoOverlay 
             title={title}
             filePath={filePath}
             videoWidth={videoRef.current?.videoWidth}
             videoHeight={videoRef.current?.videoHeight}
             mediaType="video"
             showOverlay={showMediaInfo}
             toggleOverlay={() => setShowMediaInfo(!showMediaInfo)}
           />
           <button className="media-player-close" onClick={onClose} title="Close (Esc)">
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
           </button>
        </div>
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
          mediaType="video"
          isPlaying={isPlaying} 
          duration={duration}
          volume={volume} 
          isMuted={isMuted}
          playbackSpeed={playbackSpeed}
          showSettings={showSettings}
          isFullscreen={isFullscreen}
          togglePlay={togglePlay} 
          onSeek={onSeek}
          onVolumeChange={onVolumeChange} 
          toggleMute={toggleMute}
          onSpeedChange={onSpeedChange}
          toggleSettings={toggleSettings}
          toggleFullscreen={toggleFullscreen}
          togglePiP={togglePiP}
        />
      </div>
    </>
  );
}
