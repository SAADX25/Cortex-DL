import React from 'react';
import { PlayerControls } from './PlayerControls';
import { MediaInfoOverlay } from './MediaInfoOverlay';
import { buildMediaUrl, type MediaEndpoint } from '../../lib/mediaEndpoint';

interface VideoViewProps {
  mediaEndpoint: MediaEndpoint | null;
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
  mediaEndpoint, fileUrl, title, filePath, isPlaying, duration, volume, isMuted, playbackSpeed, showSettings,
  isFullscreen, showControls, videoRef, mediaRef, ambilightRef,
  togglePlay, onSeek, onVolumeChange, toggleMute, onSpeedChange, toggleSettings, toggleFullscreen, togglePiP,
  onTimeUpdate, onLoadedMetadata, onEnded, onPlay, onPause, onClose
}: VideoViewProps) {
  const [isBuffering, setIsBuffering] = React.useState(true);
  const [showMediaInfo, setShowMediaInfo] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);
  const [subtitles, setSubtitles] = React.useState<import('../../../../Shared/types').PlayerSubtitleTrack[]>([]);
  const [activeSubtitle, setActiveSubtitle] = React.useState<number>(-1);

  React.useEffect(() => {
    if (filePath && window.cortexDl?.getSubtitles) {
      window.cortexDl.getSubtitles(filePath).then(subs => {
        setSubtitles(subs);
        if (subs && subs.length > 0) {
          setActiveSubtitle(0); 
        } else {
          setActiveSubtitle(-1);
        }
      }).catch(console.error);
    }
  }, [filePath]);

  
  React.useEffect(() => {
    if (!videoRef.current) return;
    const tracks = videoRef.current.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      if (i === activeSubtitle) {
        tracks[i].mode = 'showing';
      } else {
        tracks[i].mode = 'hidden';
      }
    }
  }, [activeSubtitle, subtitles, videoRef]);

  return (
    <>
      <div className="player-body">
        <div className="video-wrapper">
          <canvas ref={ambilightRef} className="ambilight-video" />
          
          <video
            ref={videoRef}
            className="main-video"
            src={fileUrl || undefined}
            onClick={togglePlay}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onLoadedMetadata}
            onEnded={onEnded}
            onPlay={() => { setIsBuffering(false); onPlay(); }}
            onPause={onPause}
            onLoadStart={() => setIsBuffering(true)}
            onWaiting={() => setIsBuffering(true)}
            onPlaying={() => setIsBuffering(false)}
            onCanPlay={() => setIsBuffering(false)}
            onLoadedData={() => { setIsBuffering(false); setHasError(false); }}
            onError={() => { setIsBuffering(false); setHasError(true); }}
            crossOrigin="anonymous"
            playsInline
          >
            {subtitles.map((sub, i) => {
              const srcUrl = sub.isEmbedded
                ? buildMediaUrl(filePath, mediaEndpoint, { subtitle: 'true', streamIndex: sub.streamIndex })
                : buildMediaUrl(sub.filePath, mediaEndpoint)

              if (!srcUrl) return null

              return (
                <track
                  key={`${i}-${sub.label}`}
                  kind="subtitles"
                  label={sub.label}
                  srcLang={sub.language}
                  src={srcUrl}
                  default={i === activeSubtitle}
                />
              )
            })}
          </video>

          {hasError && (
            <div className="buffering-overlay" style={{ background: 'rgba(0,0,0,0.85)', color: '#f87171', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span style={{ fontSize: '15px', fontWeight: 600 }}>Unable to play video file</span>
              <span style={{ fontSize: '13px', opacity: 0.8 }}>File may be corrupted, missing, or in an unsupported format.</span>
            </div>
          )}

          {isBuffering && !hasError && (
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
          subtitles={subtitles}
          activeSubtitle={activeSubtitle}
          onSubtitleChange={setActiveSubtitle}
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
