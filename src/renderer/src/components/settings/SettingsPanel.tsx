import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import AiSettings from './AiSettings'

interface SettingsPanelProps {
  onClose: () => void
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * App settings, as a modal over the editor (⌘, or the gear in the top
 * bar). One section today -- AI & animation -- with the nav in place for
 * the ones to come (projector defaults, library & storage, setups).
 */
export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus moves into the dialog and back to whatever had it on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  // Escape closes from anywhere while open -- including when focus has
  // fallen to <body> because the focused control just disappeared.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Keep Tab inside the dialog while it's open.
    if (event.key !== 'Tab' || !dialogRef.current) return
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // A click on the dimmed backdrop (not a drag that ends there) closes it.
  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose()
  }

  return (
    <div className="settings-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="settings-header">
          <h1 id="settings-title">Settings</h1>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            <button type="button" className="settings-nav-item" aria-current="page">
              AI &amp; animation
            </button>
          </nav>
          <div className="settings-content">
            <AiSettings />
          </div>
        </div>
      </div>
    </div>
  )
}
