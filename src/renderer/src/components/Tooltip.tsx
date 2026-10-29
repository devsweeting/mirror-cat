import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Keys drawn as little keycaps: ['⌘', 'Z'] → ⌘ Z. */
export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="keys">
      {keys.map((k, i) =>
        k === '–' ? (
          <span key={i} className="key-sep" aria-label="to">
            –
          </span>
        ) : (
          <kbd key={`${k}-${i}`} className="key">
            {k}
          </kbd>
        )
      )}
    </span>
  )
}

interface TooltipProps {
  /** What the control does, in a few words. */
  label: string
  /** Its keyboard shortcut, if any. */
  keys?: string[]
  /** Where it opens, relative to the control. */
  side?: 'top' | 'bottom'
  /** One control (a button, a select). */
  children: ReactNode
}

const SHOW_DELAY_MS = 350

/**
 * A small label with the shortcut's keycaps, on hover (after a moment) or
 * keyboard focus (straight away). Drawn in a portal with fixed position, so
 * scrolling lists and dialogs don't clip it. The wrapper takes no space
 * (display: contents); the control keeps its own accessible name and gets
 * the tooltip as its description while it shows.
 */
export default function Tooltip({ label, keys, side = 'top', children }: TooltipProps) {
  const id = useId()
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const control = useRef<Element | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const show = (wrapper: HTMLElement, delay: number): void => {
    const el = wrapper.firstElementChild
    if (!el) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect()
      control.current = el
      el.setAttribute('aria-describedby', id)
      setAt({ x: r.left + r.width / 2, y: side === 'top' ? r.top : r.bottom })
    }, delay)
  }

  const hide = (): void => {
    if (timer.current) clearTimeout(timer.current)
    control.current?.removeAttribute('aria-describedby')
    control.current = null
    setAt(null)
  }

  return (
    <span
      className="tip-anchor"
      onMouseEnter={(e) => show(e.currentTarget, SHOW_DELAY_MS)}
      onMouseLeave={hide}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible')) show(e.currentTarget, 0)
      }}
      onBlur={hide}
      onPointerDown={hide}
    >
      {children}
      {at &&
        createPortal(
          <span id={id} role="tooltip" className={`tooltip ${side}`} style={{ left: at.x, top: at.y }}>
            <span>{label}</span>
            {keys && keys.length > 0 && <Keys keys={keys} />}
          </span>,
          document.body
        )}
    </span>
  )
}
