import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { SURFACE_PALETTE, type Surface } from '@shared/types'
import { useSceneStore } from '../state/sceneStore'

interface SurfaceMenuProps {
  surface: Surface
  onRemove: () => void
}

/**
 * The things you set once per surface -- name, outline color, delete --
 * behind one "…" on the surface's row, so the drawer below is only what you
 * reach for while working. The row's dot already shows the color.
 */
export default function SurfaceMenu({ surface, onRemove }: SurfaceMenuProps) {
  const renameSurface = useSceneStore((s) => s.renameSurface)
  const updateSurfaceSettings = useSceneStore((s) => s.updateSurfaceSettings)
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draftName, setDraftName] = useState(surface.name)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const menuId = useId()
  const colorLabelId = `${menuId}-color`
  const currentColor = surface.outlineColor.toLowerCase()
  const isCustomColor = !SURFACE_PALETTE.some((c) => c === currentColor)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
    // close only reads refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open && !confirmDelete) nameRef.current?.focus()
  }, [open, confirmDelete])

  const toggle = (): void => {
    if (open) {
      close()
      return
    }
    setDraftName(surface.name)
    setConfirmDelete(false)
    setOpen(true)
  }

  // Blank names are ignored by the store, so clearing the field cancels.
  const commitName = (): void => {
    if (draftName.trim() && draftName.trim() !== surface.name) renameSurface(surface.id, draftName)
  }

  function close(returnFocus = true): void {
    commitName()
    setOpen(false)
    setConfirmDelete(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (confirmDelete) setConfirmDelete(false)
      else close()
    }
  }

  return (
    <div className="surface-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn surface-menu-button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${surface.name} options`}
        title="Name, color, delete"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          className="surface-menu-panel"
          role="dialog"
          aria-label={`${surface.name} options`}
          onKeyDown={handleKeyDown}
        >
          {confirmDelete ? (
            // Deleting throws away calibration with no undo, so it takes a
            // second click. The surface's image stays in the media library.
            <div className="surface-menu-confirm" role="alert">
              <span>Delete {surface.name} and its corner positions?</span>
              <div className="surface-menu-confirm-actions">
                <button type="button" className="btn btn-danger" onClick={onRemove}>
                  Delete
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmDelete(false)}
                  autoFocus
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <label className="surface-menu-field">
                <span className="drawer-label">Name</span>
                <input
                  ref={nameRef}
                  className="field"
                  value={draftName}
                  maxLength={40}
                  onChange={(e) => setDraftName(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') close()
                  }}
                  aria-label="Surface name"
                />
              </label>

              <div className="surface-menu-field">
                <span className="drawer-label" id={colorLabelId}>
                  Outline color
                </span>
                <div className="swatches" role="radiogroup" aria-labelledby={colorLabelId}>
                  {SURFACE_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      className="swatch"
                      aria-checked={currentColor === color}
                      aria-label={color}
                      title={color.toUpperCase()}
                      style={{ '--swatch': color } as CSSProperties}
                      onClick={() => updateSurfaceSettings(surface.id, { outlineColor: color })}
                    />
                  ))}
                  <label
                    className={`swatch swatch-custom${isCustomColor ? ' checked' : ''}`}
                    title="Pick any color"
                    style={
                      isCustomColor ? ({ '--swatch': currentColor } as CSSProperties) : undefined
                    }
                  >
                    <input
                      type="color"
                      value={currentColor}
                      aria-label="Custom outline color"
                      onChange={(e) =>
                        updateSurfaceSettings(surface.id, { outlineColor: e.target.value })
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="surface-menu-divider" />
              <button
                type="button"
                className="surface-menu-delete"
                onClick={() => setConfirmDelete(true)}
              >
                Delete surface
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
