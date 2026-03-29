import React from 'react'
import { motion } from 'framer-motion'

type Option = { value: string; label?: React.ReactNode }

type Props = {
  options: Option[]
  value: string
  onChange: (v: string) => void
  size?: 'sm' | 'md'
  wrap?: boolean
  className?: string
}

const HIGH_TRANS = { type: 'spring', stiffness: 500, damping: 30 }

export default function AnimatedSegmentedControl({ options, value, onChange, size = 'md', wrap = false, className }: Props) {
  const paddingX = size === 'sm' ? 6 : 10

  return (
    <div style={{ display: wrap ? 'block' : 'inline-block', width: wrap ? '100%' : undefined }} className={className}>
      <div
        role="tablist"
        style={{
          position: 'relative',
          display: 'flex',
          gap: 8,
          rowGap: 8,
          flexWrap: wrap ? 'wrap' : 'nowrap',
          background: 'rgba(255,255,255,0.03)',
          padding: 6,
          borderRadius: 999,
          alignItems: 'center',
        }}
      >
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <div key={String(opt.value)} style={{ position: 'relative', zIndex: 1 }}>
              {active && (
                <motion.div
                  layoutId="seg-highlighter"
                  initial={false}
                  transition={HIGH_TRANS}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 999,
                    background: 'linear-gradient(90deg, rgba(79,70,229,0.95), rgba(14,165,233,0.95))',
                    boxShadow: '0 6px 18px rgba(14,165,233,0.12)',
                  }}
                />
              )}

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => onChange(String(opt.value))}
                aria-pressed={active}
                style={{
                  position: 'relative',
                  appearance: 'none',
                  border: 'none',
                  background: 'transparent',
                  padding: `${size === 'sm' ? 6 : 8}px ${paddingX}px`,
                  borderRadius: 999,
                  color: active ? '#ffffff' : '#9ca3af',
                  fontWeight: 600,
                  fontSize: size === 'sm' ? 13 : 14,
                  cursor: 'pointer',
                  zIndex: 2,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 56,
                }}
              >
                <motion.span
                  animate={{ color: active ? '#ffffff' : '#9ca3af' }}
                  transition={{ duration: 0.18 }}
                >
                  {opt.label ?? opt.value}
                </motion.span>
              </motion.button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
