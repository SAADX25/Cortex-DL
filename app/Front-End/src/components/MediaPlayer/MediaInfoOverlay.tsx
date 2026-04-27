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
}

export function MediaInfoOverlay({ title, filePath, videoWidth, videoHeight, mediaType, showOverlay, toggleOverlay, taskFps }: MediaInfoProps) {
  const extension = filePath.split('.').pop()?.toUpperCase() || 'UNKNOWN';
  const [fps, setFps] = useState<number | string | null>(taskFps || null);

  useEffect(() => {
    if (showOverlay && mediaType === 'video' && !fps) {
      if (window.cortexDl?.getMediaFps) {
        console.log('[MediaInfoOverlay] Fetching FPS for:', filePath);
        window.cortexDl.getMediaFps(filePath).then((val: number | null) => {
          console.log('[MediaInfoOverlay] Received FPS:', val);
          if (val) {
            setFps(val);
          } else {
            setFps('Unknown');
          }
        }).catch(err => {
          console.error('[MediaInfoOverlay] Error fetching FPS:', err);
          setFps('Error');
        });
      }
    }
  }, [showOverlay, filePath, mediaType, fps]);

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
            <span className="info-label">Title</span>
            <span className="info-value">{title}</span>
            
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
