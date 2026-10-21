import { useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import { hasPreview, thumbnailUrl } from '@shared/media'
import { useSceneStore } from '../state/sceneStore'
import { useMediaStore } from '../state/mediaStore'
import SurfaceSettingsDrawer from './SurfaceSettingsDrawer'

interface SidebarProps {
  selectedSurfaceId: string | null
  onSelectSurface: (id: string) => void
}

/** Custom drag type, so surface drags never get mistaken for file drops. */
const SURFACE_DRAG_TYPE = 'application/x-mirrorcat-surface'

type DropTarget = { id: string; placement: 'above' | 'below' }

/**
 * The surface list, styled like a layer list: one quiet row per surface,
 * showing what's on it. Projector controls live in the top bar and Cat
 * lives under the stage, so this panel is only about surfaces.
 *
 * Like a layers panel, the list is front to back: the top row is drawn on
 * top on the projector. Rows can be dragged to restack, or moved with
 * Alt+↑/↓ when focused.
 */
export default function Sidebar({ selectedSurfaceId, onSelectSurface }: SidebarProps) {
  const surfaces = useSceneStore((s) => s.surfaces)
  const addSurface = useSceneStore((s) => s.addSurface)
  const removeSurface = useSceneStore((s) => s.removeSurface)
  const updateSurfaceSettings = useSceneStore((s) => s.updateSurfaceSettings)
  const moveSurface = useSceneStore((s) => s.moveSurface)
  const stepSurface = useSceneStore((s) => s.stepSurface)

  // The store is back-to-front (draw order); the list shows front first.
  const frontToBack = [...surfaces].reverse()

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const handleDragStart = (id: string) => (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData(SURFACE_DRAG_TYPE, id)
    event.dataTransfer.effectAllowed = 'move'
    setDraggingId(id)
  }

  // Top half of a row = drop in front of it, bottom half = behind it.
  const handleDragOver = (id: string) => (event: DragEvent<HTMLLIElement>) => {
    if (!draggingId || !event.dataTransfer.types.includes(SURFACE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const placement = event.clientY < rect.top + rect.height / 2 ? 'above' : 'below'
    if (dropTarget?.id !== id || dropTarget.placement !== placement) {
      setDropTarget(id === draggingId ? null : { id, placement })
    }
  }

  const handleDrop = (event: DragEvent<HTMLLIElement>) => {
    if (!event.dataTransfer.types.includes(SURFACE_DRAG_TYPE)) return
    event.preventDefault()
    const id = event.dataTransfer.getData(SURFACE_DRAG_TYPE)
    if (id && dropTarget) moveSurface(id, dropTarget.id, dropTarget.placement)
    endDrag()
  }

  const endDrag = (): void => {
    setDraggingId(null)
    setDropTarget(null)
  }

  // Alt+↑ brings a surface forward, Alt+↓ sends it back.
  const handleRowKeyDown = (id: string) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    stepSurface(id, event.key === 'ArrowUp' ? 1 : -1)
  }

  // Which surfaces have their settings drawer open. UI-only, so it lives here
  // rather than in the scene store that gets synced to the projector.
  const [openDrawers, setOpenDrawers] = useState<ReadonlySet<string>>(() => new Set())

  const toggleDrawer = (id: string): void => {
    setOpenDrawers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const add = (): void => {
    const id = addSurface(`Surface ${surfaces.length + 1}`)
    onSelectSurface(id)
  }

  return (
    <aside className="sidebar" aria-label="Surfaces">
      <header className="panel-head">
        <h2 className="panel-title">Surfaces</h2>
        {surfaces.length > 0 && <span className="panel-count num">{surfaces.length}</span>}
      </header>

      <ul className="surface-list" aria-label="Surfaces, front to back">
        {frontToBack.map((surface) => {
          const isOpen = openDrawers.has(surface.id)
          const isActive = surface.id === selectedSurfaceId
          const drawerId = `surface-drawer-${surface.id}`
          const drop = dropTarget?.id === surface.id ? dropTarget.placement : null
          return (
            <li
              key={surface.id}
              className={[
                'surface-item',
                isActive && 'active',
                isOpen && 'open',
                !surface.visible && 'hidden-surface',
                draggingId === surface.id && 'dragging',
                drop && `drop-${drop}`
              ]
                .filter(Boolean)
                .join(' ')}
              // Drives the row's accents so the sidebar entry matches the
              // outline drawn on the canvas.
              style={{ '--surface-color': surface.outlineColor } as CSSProperties}
              onDragOver={handleDragOver(surface.id)}
              onDrop={handleDrop}
            >
              <div
                className="surface-row"
                draggable
                onDragStart={handleDragStart(surface.id)}
                onDragEnd={endDrag}
              >
                <button
                  type="button"
                  className="visibility-toggle"
                  onClick={() => updateSurfaceSettings(surface.id, { visible: !surface.visible })}
                  aria-pressed={surface.visible}
                  aria-label={`${surface.visible ? 'Hide' : 'Show'} ${surface.name}`}
                  title={surface.visible ? 'Hide surface' : 'Show surface'}
                >
                  <span className="visibility-dot" aria-hidden="true" />
                </button>
                {/* Selects the surface and opens/closes its settings drawer. */}
                <button
                  type="button"
                  className="surface-header"
                  onClick={() => {
                    onSelectSurface(surface.id)
                    toggleDrawer(surface.id)
                  }}
                  onKeyDown={handleRowKeyDown(surface.id)}
                  aria-expanded={isOpen}
                  aria-controls={drawerId}
                  title="Drag to restack"
                >
                  <SurfaceThumb assetId={surface.assetId} />
                  <span className="surface-name">{surface.name}</span>
                  <span className="chevron" aria-hidden="true" />
                </button>
              </div>
              <div id={drawerId} hidden={!isOpen}>
                {isOpen && (
                  <SurfaceSettingsDrawer
                    surface={surface}
                    onRemove={() => removeSurface(surface.id)}
                    onFocusSurface={() => onSelectSurface(surface.id)}
                  />
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <button type="button" className="add-surface" onClick={add}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Add surface
      </button>
    </aside>
  )
}

/** What's on the surface, at a glance. Empty slot when there's nothing (yet) to show. */
function SurfaceThumb({ assetId }: { assetId: string | null }) {
  const asset = useMediaStore((s) => (assetId ? s.assets.find((a) => a.id === assetId) : undefined))
  return (
    <span className="surface-thumb" aria-hidden="true">
      {asset && hasPreview(asset) ? (
        <img src={thumbnailUrl(asset.id)} alt="" draggable={false} />
      ) : null}
    </span>
  )
}
