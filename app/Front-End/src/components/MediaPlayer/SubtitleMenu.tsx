import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Subtitles } from 'lucide-react'
import type { PlayerSubtitleTrack } from '../../../../Shared/types'
import { useLang } from '../../stores/useSettingsStore'

function trackName(track: PlayerSubtitleTrack, lang: string): string {
  const code = track.language.trim()
  try {
    const name = new Intl.DisplayNames([lang], { type: 'language' }).of(code)
    if (name && name !== code && !['und', 'unknown'].includes(code)) return name
  } catch { /* Custom track labels need not be language codes. */ }
  return track.label || code
}

export function SubtitleMenu({ tracks, active, onChange, onOpenChange }: {
  tracks: PlayerSubtitleTrack[]; active: number; onChange: (index: number) => void; onOpenChange?: (open: boolean) => void
}) {
  const lang = useLang(), ar = lang === 'ar'
  const title = ar ? 'الترجمة' : 'Subtitles', off = ar ? 'إيقاف الترجمة' : 'Subtitles off'
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const options = useRef<(HTMLButtonElement | null)[]>([]), id = useId()
  const selected = active >= 0 && active < tracks.length ? active : -1
  const names = tracks.map(track => trackName(track, lang))
  useEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false) }, [open, onOpenChange])
  useEffect(() => {
    if (!open) return
    options.current[selected + 1]?.focus()
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false) }
    const focusOutside = (event: FocusEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', focusOutside, true)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', focusOutside, true); document.removeEventListener('keydown', escape, true) }
  }, [open, selected])
  const select = (index: number) => { onChange(index); setOpen(false); trigger.current?.focus() }
  return <div className="subtitle-menu-wrapper" ref={wrapper} onClick={e => e.stopPropagation()}
    onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}
    onKeyDown={e => {
      e.stopPropagation()
      if (!open && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); return }
      if (open && ['Enter', ' '].includes(e.key) && e.target instanceof HTMLButtonElement && e.target.getAttribute('role') === 'menuitemradio') {
        e.preventDefault(); select(options.current.indexOf(e.target) - 1); return
      }
      if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      e.preventDefault()
      const current = options.current.indexOf(document.activeElement as HTMLButtonElement), count = tracks.length + 1
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + count) % count
      options.current[next]?.focus()
    }}>
    <button ref={trigger} type="button" className={`control-btn subtitle-trigger ${selected !== -1 ? 'active' : ''}`}
      aria-label={`${title}: ${selected === -1 ? off : names[selected]}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      title={title} onClick={() => setOpen(value => !value)}>
      <Subtitles size={20} /><span className="subtitle-current" dir="auto">{selected === -1 ? ar ? 'متوقفة' : 'Off' : names[selected]}</span><ChevronDown size={13} />
    </button>
    {open && <div className="subtitle-menu" id={id} role="menu" aria-label={title} dir={ar ? 'rtl' : 'ltr'}>
      <div className="subtitle-menu-title"><Subtitles size={16} />{title}</div>
      {[-1, ...tracks.map((_, index) => index)].map(index => <button key={index} type="button"
        ref={element => { options.current[index + 1] = element }} role="menuitemradio" aria-checked={selected === index} tabIndex={selected === index ? 0 : -1}
        className="subtitle-option" onClick={() => select(index)}>
        <span><span dir="auto">{index === -1 ? off : names[index]}</span>{index >= 0 && tracks[index].label !== tracks[index].language && tracks[index].label !== names[index] && <small dir="auto">{tracks[index].label}</small>}</span>
        {selected === index && <Check size={17} />}
      </button>)}
    </div>}
  </div>
}
