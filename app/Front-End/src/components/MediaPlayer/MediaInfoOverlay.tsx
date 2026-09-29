import { Info } from 'lucide-react';
import { useState, useEffect } from 'react';

interface MediaInfoProps {
  title: string;
  filePath: string;
  videoWidth?: number;
  videoHeight?: number;
  mediaType: 'video' | 'audio';
  showOverlay: boolean;
  toggleOverlay: () => void;
  taskFps?: number | string;
  sessionId: string;
}

export function MediaInfoOverlay({ filePath, videoWidth, videoHeight, mediaType, showOverlay, toggleOverlay, taskFps, sessionId }: MediaInfoProps) {
  const extension = filePath.split('.').pop()?.toUpperCase() || 'UNKNOWN';
  const [fps, setFps] = useState<number | string | null>(taskFps || null);

  useEffect(() => {
    let cancelled = false;
    if (showOverlay && mediaType === 'video' && !fps) {
      if (window.cortexDl?.getMediaFps) {
        window.cortexDl.getMediaFps(filePath, sessionId).then((val: number | null) => {
          if (cancelled) return;
          if (val) {
            setFps(val);
          } else {
            setFps('Unknown');
          }
        }).catch(err => {
          if (!cancelled) {
            console.error('[MediaInfoOverlay] Error fetching FPS:', err);
            setFps('Error');
          }
        });
      }
    }
    return () => { cancelled = true; };
  }, [showOverlay, filePath, mediaType, fps, sessionId]);

  return (
    <>
      <button 
        className={`media-info-toggle ${showOverlay ? 'active' : ''}`} 
        onClick={(e) => { e.stopPropagation(); toggleOverlay(); }}
        title="Media Info"
      >
        <Info size={20} />
      </button>
      
      {showOverlay && (
        <div className="media-info-panel" onClick={(e) => e.stopPropagation()}>
          <h4 className="media-info-title">Media Information</h4>
          <div className="media-info-grid">
            <span className="info-label">Format</span>
            <span className="info-value">{extension}</span>
            
            {mediaType === 'video' && videoWidth && videoHeight && (
              <>
                <span className="info-label">Resolution</span>
                <span className="info-value">{videoWidth} x {videoHeight}</span>
              </>
            )}
            
            {mediaType === 'video' && (
              <>
                <span className="info-label">FPS</span>
                <span className="info-value path-value">{fps ? `${fps} FPS` : 'Reading...'}</span>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
