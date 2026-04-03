/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  useDebounce — High-performance debounce hook
 *
 *  Delays updating state until after the user stops typing/changing for
 *  a specified duration. Prevents excessive re-renders on rapid input changes.
 *
 *  Usage:
 *    const [input, setInput] = useState('')
 *    const debouncedValue = useDebounce(input, 300)
 *    // Re-render only when typing pauses for 300ms
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useState, useEffect } from 'react'

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delayMs)

    return () => clearTimeout(handler)
  }, [value, delayMs])

  return debouncedValue
}
