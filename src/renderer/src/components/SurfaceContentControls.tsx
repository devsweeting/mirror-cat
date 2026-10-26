import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Surface, SurfaceFit } from '@shared/types'
import { formatDuration, type MediaAsset } from '@shared/media'
import { useSceneStore } from '../state/sceneStore'
import { pickAndImport, useMediaStore } from '../state/mediaStore'
import { useUiStore } from '../state/uiStore'
import MediaThumb from './MediaThumb'

interface SurfaceContentControlsProps {
  surface: Surface
  /** Make this the selected surface, so the library panel assigns to it. */
  onFocusSurface: () => void
}

const FIT_OPTIONS: { value: SurfaceFit; label: string; title: string }[] = [
  { value: 'stretch', label: 'Stretch', title: 'Stretch the image to the surface corners' },
  { value: 'fill', label: 'Fill', title: 'Keep the image’s proportions and crop the overflow' }
]

/** "1920×1080 · 0:12", or what's still unknown about a fresh video. */
function describeAsset(asset: MediaAsset): string {
  if (asset.kind === 'video' && asset.playable === false) return 'Can’t play this video here'
  if (!asset.width || !asset.height) return 'Reading video…'
  const size = `${asset.width}×${asset.height}`
  return asset.durationMs ? `${size} · ${formatDuration(asset.durationMs)}` : size
}

/**
 * The "Content" block of a surface's settings drawer. The preview row is a
 * single button; clicking it opens a small menu with upload / choose from
 * library / remove, so those actions don't take up permanent sidebar space.
 */
export default function SurfaceContentControls({
  surface,
  onFocusSurface
}: SurfaceContentControlsProps) {
  const asset = useMediaStore((s) =>
    surface.assetId ? s.assets.find((a) => a.id === surface.assetId) : undefined
  )
  const loaded = useMediaStore((s) => s.loaded)
  const importing = useMediaStore((s) => s.importing)
  const setSurfaceAsset = useSceneStore((s) => s.setSurfaceAsset)
  const updateSurfaceSettings = useSceneStore((s) => s.updateSurfaceSettings)
  const replaySurface = useSceneStore((s) => s.replaySurface)
  const setLibraryOpen = useUiStore((s) => s.setLibraryOpen)

  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const missing = loaded && surface.assetId !== null && !asset

  // Close on any click outside the trigger + menu.
  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [menuOpen])

  // Move focus into the menu when it opens, for keyboard users.
  useEffect(() => {
    if (menuOpen)
      menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [menuOpen])

  const closeMenu = (returnFocus = true): void => {
    setMenuOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  const upload = async (): Promise<void> => {
    closeMenu(false)
    const [first] = await pickAndImport()
    if (first) setSurfaceAsset(surface.id, first.id)
  }

  const openLibrary = (): void => {
    closeMenu(false)
    onFocusSurface()
    setLibraryOpen(true)
  }

  const clear = (): void => {
    setSurfaceAsset(surface.id, null)
    closeMenu()
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
    )
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(index + step + items.length) % items.length]?.focus()
  }

  return (
    <div className="content-controls" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`content-current${menuOpen ? ' open' : ''}`}
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        title="Change media"
      >
        <span className="content-thumb">
          {asset ? (
            <MediaThumb asset={asset} />
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M8 3.5v9M3.5 8h9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          )}
          {importing && <span className="content-thumb-busy" aria-hidden="true" />}
        </span>
        <span className="content-meta">
          <span className={`content-name${missing ? ' missing' : ''}`}>
            {asset ? asset.name : missing ? 'Missing file' : 'Add an image or video'}
          </span>
          <span
            className={`content-sub${asset?.kind === 'video' && asset.playable === false ? ' warn' : ''}`}
          >
            {importing
              ? 'Adding…'
              : asset
                ? describeAsset(asset)
                : missing
                  ? 'Removed from the library'
                  : 'Click to upload or choose'}
          </span>
        </span>
        <span className="chevron" aria-hidden="true" />
      </button>

      {menuOpen && (
        <div
          id={menuId}
          ref={menuRef}
          className="content-menu"
          role="menu"
          aria-label={`Media for ${surface.name}`}
          onKeyDown={handleMenuKeyDown}
        >
          <button type="button" role="menuitem" onClick={() => void upload()} disabled={importing}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M8 10.5V3M5 6l3-3 3 3M3 10.5v2h10v-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Upload image or video…
          </button>
          <button type="button" role="menuitem" onClick={openLibrary}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect
                x="2"
                y="2"
                width="5"
                height="5"
                rx="1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <rect
                x="9"
                y="2"
                width="5"
                height="5"
                rx="1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <rect
                x="2"
                y="9"
                width="5"
                height="5"
                rx="1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <rect
                x="9"
                y="9"
                width="5"
                height="5"
                rx="1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            Choose from library
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={clear}
            disabled={surface.assetId === null}
            title="It stays in the library"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            Remove from surface
          </button>
        </div>
      )}

      {/* Fit only means something once there's an image to fit. */}
      {surface.assetId !== null && (
        <div className="drawer-row">
          <span className="drawer-label">Fit</span>
          <div className="segmented" role="radiogroup" aria-label="Image fit">
            {FIT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={surface.fit === option.value}
                title={option.title}
                onClick={() => updateSurfaceSettings(surface.id, { fit: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Videos: loop forever, or play once and hold the last frame. */}
      {asset?.kind === 'video' && (
        <div className="drawer-row">
          <span className="drawer-label">Playback</span>
          <div className="playback-controls">
            <div className="segmented" role="radiogroup" aria-label="Video playback">
              <button
                type="button"
                role="radio"
                aria-checked={surface.loop}
                title="Loop the video forever"
                onClick={() => updateSurfaceSettings(surface.id, { loop: true })}
              >
                Loop
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!surface.loop}
                title="Play once, then hold the last frame"
                onClick={() => updateSurfaceSettings(surface.id, { loop: false })}
              >
                Once
              </button>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => replaySurface(surface.id)}
              aria-label={`Restart the video on ${surface.name}`}
              title="Restart from the beginning"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5M3 2.5v2.8h2.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
