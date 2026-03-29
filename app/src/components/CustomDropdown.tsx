import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

type Group = {
  label?: string
  options: { value: string; label: string }[]
}

type Props = {
  value: string
  onChange: (v: string) => void
  groups?: Group[]
  ariaLabel?: string
}

export default function CustomDropdown({ value, onChange, groups = [], ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; minWidth?: number } | null>(null)

  // Close when clicking outside (works with portal)
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (wrapperRef.current && wrapperRef.current.contains(t)) return
      if (menuRef.current && menuRef.current.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const computePosition = () => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const menuWidth = 144
    // Prefer aligning left edge with button, but clamp to viewport
    let left = rect.left
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8)
    }
    const top = rect.bottom + 8
    setMenuPos({ top, left, minWidth: Math.max(menuWidth, rect.width) })
  }

  useLayoutEffect(() => {
    if (open) computePosition()
  }, [open])

  useEffect(() => {
    function onWindow() {
      if (open) computePosition()
    }
    window.addEventListener('resize', onWindow)
    window.addEventListener('scroll', onWindow, true)
    return () => {
      window.removeEventListener('resize', onWindow)
      window.removeEventListener('scroll', onWindow, true)
    }
  }, [open])

  const currentLabel = () => {
    for (const g of groups) {
      const found = g.options.find((o) => o.value === value)
      if (found) return found.label
    }
    return value
  }

  const currentGroup = groups.find((g) => g.options.some((o) => o.value === value))
  const currentColor = currentGroup && /video/i.test(currentGroup.label || '') ? '#2563eb' : '#f97316'

  const menu = open && menuPos ? createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: menuPos.top,
        left: menuPos.left,
        background: '#1e293b',
        border: '1px solid #374151',
        borderRadius: 12,
        boxShadow: '0 10px 25px rgba(2,6,23,0.6)',
        padding: 4,
        zIndex: 9999,
        minWidth: menuPos.minWidth,
        overflow: 'hidden',
      }}
    >
      {groups.map((g, gi) => (
        <div key={gi} style={{ padding: '2px 0' }}>
          {g.label && (
            <div style={{ padding: '4px 8px', color: '#6b7280', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', margin: 0 }}>
              {g.label}
            </div>
          )}

          {g.options.map((opt) => (
            <div
              key={opt.value}
              role="menuitem"
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              style={{
                padding: '6px 8px',
                color: '#e6eef8',
                fontSize: 12,
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ width: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {g.label && /video/i.test(g.label) ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" stroke="#9fbffb" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 9l6 3-6 3V9z" fill="#60a5fa"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v10" stroke="#ffb27a" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M19 7a4 4 0 0 1-4 4H9v6a3 3 0 0 1-3 3" stroke="#f59e0b" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                )}
              </span>
              <span style={{ flex: 1, fontSize: 12 }}>{opt.label}</span>
              <span style={{ width: 10, height: 10, borderRadius: 6, background: /video/i.test(g.label || '') ? '#2563eb' : '#f97316', display: 'inline-block', marginLeft: 6 }} />
              {value === opt.value && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12l4 4L19 6" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
            </div>
          ))}

          {gi !== groups.length - 1 && (
            <div style={{ height: 1, background: 'rgba(255,255,255,0.03)', margin: '4px 2px', borderRadius: 1 }} />
          )}
        </div>
      ))}
    </div>,
    document.body
  ) : null

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        aria-label={ariaLabel || 'Select format'}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderRadius: 9999,
          background: '#0b1220',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.04)',
          fontWeight: 600,
          cursor: 'pointer',
          minWidth: 92,
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 6, background: currentColor, display: 'inline-block' }} />
        <span style={{ fontSize: 12 }}>{currentLabel()}</span>
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 7l5 5 5-5" stroke="#cbd5e1" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {menu}
    </div>
  )
}
