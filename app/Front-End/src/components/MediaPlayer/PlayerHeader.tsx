import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLang } from '../../stores/useSettingsStore';

export function PlayerHeader({ title, visible, onClose, actions }: {
  title: string;
  visible: boolean;
  onClose: () => void;
  actions?: ReactNode;
}) {
  const lang = useLang();
  const back = lang === 'ar' ? 'رجوع' : 'Back';
  const label = lang === 'ar' ? 'الرجوع إلى البرنامج (Esc)' : 'Back to app (Esc)';
  return <div className="player-header" dir={lang === 'ar' ? 'rtl' : 'ltr'}
    style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' }}
    onClick={event => event.stopPropagation()} ref={node => { if (node) node.inert = !visible; }}>
    <button type="button" className="media-player-close player-back" onClick={onClose} title={label} aria-label={label}>
      <ArrowLeft size={18} aria-hidden="true" /><span>{back}</span>
    </button>
    <span className="player-header-title" title={title} dir="auto">{title}</span>
    {actions && <div className="player-header-actions">{actions}</div>}
  </div>;
}
