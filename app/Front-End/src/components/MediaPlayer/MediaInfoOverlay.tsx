import { Info } from 'lucide-react';

interface MediaInfoProps {
  title: string;
  filePath: string;
  videoWidth?: number;
  videoHeight?: number;
  mediaType: 'video' | 'audio';
  showOverlay: boolean;
  toggleOverlay: () => void;
}

export function MediaInfoOverlay({ title, filePath, videoWidth, videoHeight, mediaType, showOverlay, toggleOverlay }: MediaInfoProps) {
  const extension = filePath.split('.').pop()?.toUpperCase() || 'UNKNOWN';
  
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
            
            <span className="info-label">Path</span>
            <span className="info-value path-value" title={filePath}>{filePath}</span>
          </div>
        </div>
      )}
    </>
  );
}
