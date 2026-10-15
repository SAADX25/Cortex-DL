import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import './SubtitleLanguageSelect.css'

type Option = { value: string; label: string; keywords?: string }
type Position = { left: number; width: number; maxHeight: number; top?: number; bottom?: number }

export default function SubtitleLanguageSelect({ label, value, options, onChange, disabled, lang }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled: boolean; lang: 'en' | 'ar'
}) {
  const id = useId(), ar = lang === 'ar'
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const [position, setPosition] = useState<Position | null>(null)
  const wrapper = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const positioned = position !== null
  const menuHeight = position?.maxHeight ?? 0
  const term = query.trim().toLocaleLowerCase(lang)
  const filtered = options.filter(option => `${option.label} ${option.keywords ?? ''} ${option.value}`.toLocaleLowerCase(lang).includes(term))
  const highlighted = Math.min(active, filtered.length - 1)
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus() }
  const show = () => { if (!disabled) { setQuery(''); setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true) } }
  const select = (option: Option) => { onChange(option.value); close(true) }
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!trigger.current) return
      const rect = trigger.current.getBoundingClientRect(), padding = 12, gap = 7

      if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return }
      const below = Math.max(0, window.innerHeight - rect.bottom - gap - padding), above = Math.max(0, rect.top - gap - padding)
      const upwards = below < 240 && above > below
      const width = Math.min(rect.width, window.innerWidth - padding * 2)
      setPosition({ width, left: Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding)), maxHeight: Math.min(272, upwards ? above : below),
        ...(upwards ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }) })
    }
    place()
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place() }
    window.addEventListener('resize', place); window.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true) }
  }, [open])
  useEffect(() => {
    if (!open || !positioned) return
    search.current?.focus()
  }, [open, positioned])
  useLayoutEffect(() => {
    if (open && positioned) optionRefs.current[highlighted]?.scrollIntoView({ block: 'nearest' })
  }, [open, positioned, highlighted, query, menuHeight])
  useEffect(() => {
    if (!open) return
    const within = (target: EventTarget | null) => wrapper.current?.contains(target as Node) || menu.current?.contains(target as Node)
    const outside = (event: PointerEvent | FocusEvent) => { if (!within(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', outside, true); document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside, true); document.removeEventListener('keydown', escape, true) }
  }, [open])
  return <div className="ss-language-field" ref={wrapper}>
    <label htmlFor={`${id}-trigger`}>{label}</label>
    <button id={`${id}-trigger`} ref={trigger} type="button" className="ss-language-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
      onClick={() => open ? close() : show()} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); show() } }}>
      <span>{options.find(option => option.value === value)?.label ?? value}</span><ChevronDown size={16} />
    </button>
    {open && position && createPortal(<div className="ss-language-menu" ref={menu} dir={ar ? 'rtl' : 'ltr'} style={position}>
      <div className="ss-language-search"><Search size={15} /><input ref={search} role="combobox" aria-label={ar ? 'البحث عن لغة' : 'Search languages'} placeholder={ar ? 'ابحث عن لغة…' : 'Search languages…'}
        aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={highlighted >= 0 ? `${id}-option-${filtered[highlighted].value}` : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setActive(0) }}
        onKeyDown={event => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setActive(filtered.length ? (highlighted + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length : 0) }
          else if (event.key === 'Enter') { event.preventDefault(); if (filtered[highlighted]) select(filtered[highlighted]) }
          else if (event.key === 'Tab') close(true)
        }} /></div>
      <div className="ss-language-list" id={`${id}-list`} role="listbox" aria-label={label} style={{ maxHeight: Math.max(0, position.maxHeight - 57) }}>
        {filtered.map((option, index) => <button key={option.value} id={`${id}-option-${option.value}`} ref={element => { optionRefs.current[index] = element }} type="button" role="option" tabIndex={-1}
          aria-selected={value === option.value} data-highlighted={highlighted === index} data-value={option.value} className="ss-language-option" onClick={() => select(option)}>
          <span>{option.label}</span>{value === option.value && <Check size={15} />}
        </button>)}
        {!filtered.length && <p className="ss-language-empty">{ar ? 'لا توجد لغة مطابقة' : 'No matching languages'}</p>}
      </div>
    </div>, document.body)}
  </div>
}
