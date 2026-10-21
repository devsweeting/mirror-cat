import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { SURFACE_PALETTE, type Surface } from '@shared/types'
import { useSceneStore } from '../state/sceneStore'
import { editEdgeNodes } from '../state/shapeHistory'
import {
  MAX_EDGE_NODES,
  addNodeOnLongestSegment,
  countEdgeNodes,
  removeNewestEdgeNode
} from '@shared/surfaceGeometry'
import SurfaceContentControls from './SurfaceContentControls'

interface SurfaceSettingsDrawerProps {
  surface: Surface
  onRemove: () => void
  onFocusSurface: () => void
}

/**
 * Per-surface settings hub, shown when a surface row in the sidebar is
 * expanded. New surface-level controls belong here rather than in the
 * global sidebar sections.
 */
export default function SurfaceSettingsDrawer({
  surface,
  onRemove,
  onFocusSurface
}: SurfaceSettingsDrawerProps) {
  const updateSurfaceSettings = useSceneStore((s) => s.updateSurfaceSettings)
  const renameSurface = useSceneStore((s) => s.renameSurface)
  const [mode, setMode] = useState<'idle' | 'renaming' | 'confirmDelete'>('idle')
  const [draftName, setDraftName] = useState(surface.name)
  const extraNodes = countEdgeNodes(surface.edgeNodes)
  const baseId = useId()
  const nodeHelpId = `${baseId}-node-help`
  const [showNodeHelp, setShowNodeHelp] = useState(false)
  const colorLabelId = `${baseId}-outline`
  const opacityId = `${baseId}-opacity`
  const opacityPct = Math.round(surface.opacity * 100)
  const currentColor = surface.outlineColor.toLowerCase()
  const isCustomColor = !SURFACE_PALETTE.some((c) => c === currentColor)

  const startRename = (): void => {
    setDraftName(surface.name)
    setMode('renaming')
  }

  // Blank names are ignored by the store, so this also covers "cancel by
  // clearing the field".
  const commitRename = (): void => {
    renameSurface(surface.id, draftName)
    setMode('idle')
  }

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') commitRename()
    if (event.key === 'Escape') setMode('idle')
  }

  return (
    <div className="surface-drawer">
      <div className="drawer-actions">
        {mode === 'renaming' && (
          <input
            className="field rename-input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={commitRename}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Surface name"
            maxLength={40}
            autoFocus
          />
        )}

        {mode === 'confirmDelete' && (
          // Deleting throws away calibration with no undo, so it takes a
          // second click. The surface's image stays in the media library.
          <div className="delete-confirm" role="alert">
            <span>Delete {surface.name} and its corner positions?</span>
            <div className="delete-confirm-actions">
              <button type="button" className="btn btn-danger" onClick={onRemove}>
                Delete
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === 'idle' && (
          <>
            <button
              type="button"
              className="icon-btn"
              onClick={startRename}
              aria-label={`Rename ${surface.name}`}
              title="Rename surface"
            >
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path
                  d="M10.8 2.4l2.8 2.8-7.9 7.9-3.4.6.6-3.4 7.9-7.9zM9.4 3.8l2.8 2.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMode('confirmDelete')}
              aria-label={`Delete ${surface.name}`}
              title="Delete surface"
            >
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path
                  d="M2.5 4.2h11M6.2 4.2V2.6h3.6v1.6M3.9 4.2l.7 9.2h6.8l.7-9.2M6.6 6.6v4.5M9.4 6.6v4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        )}
      </div>

      <SurfaceContentControls surface={surface} onFocusSurface={onFocusSurface} />

      <div className="drawer-field">
        <span className="drawer-label" id={colorLabelId}>
          Outline
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
          {/* Any other color: the native picker, dressed as the last swatch. */}
          <label
            className={`swatch swatch-custom${isCustomColor ? ' checked' : ''}`}
            title="Pick any color"
            style={isCustomColor ? ({ '--swatch': currentColor } as CSSProperties) : undefined}
          >
            <input
              type="color"
              value={currentColor}
              aria-label="Custom outline color"
              onChange={(e) => updateSurfaceSettings(surface.id, { outlineColor: e.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="drawer-field">
        <div className="drawer-row">
          <label className="drawer-label" htmlFor={opacityId}>
            Opacity
          </label>
          <span className="drawer-value num">{opacityPct}%</span>
        </div>
        <input
          id={opacityId}
          className="slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacityPct}
          style={{ '--fill': `${opacityPct}%` } as CSSProperties}
          onChange={(e) =>
            updateSurfaceSettings(surface.id, { opacity: Number(e.target.value) / 100 })
          }
        />
      </div>

      <div className="drawer-row">
        <span className="drawer-label label-with-info">
          Edge points
          <button
            type="button"
            className="info-button"
            onClick={() => setShowNodeHelp((v) => !v)}
            aria-expanded={showNodeHelp}
            aria-controls={nodeHelpId}
            aria-label="How to edit edge points"
            title="How to edit edge points"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="8" cy="5" r="0.9" fill="currentColor" />
              <path d="M8 7.3v4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </span>
        <div className="stepper">
          <button
            type="button"
            className="icon-btn"
            disabled={extraNodes === 0}
            onClick={() => editEdgeNodes(surface.id, removeNewestEdgeNode(surface.edgeNodes))}
            aria-label="Remove newest edge point"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <span className="drawer-value num" aria-live="polite">
            {surface.corners.length + extraNodes}
          </span>
          <button
            type="button"
            className="icon-btn"
            disabled={extraNodes >= MAX_EDGE_NODES}
            onClick={() =>
              editEdgeNodes(surface.id, addNodeOnLongestSegment(surface.corners, surface.edgeNodes))
            }
            aria-label="Add edge point"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M8 3.5v9M3.5 8h9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div id={nodeHelpId} className="drawer-help" hidden={!showNodeHelp}>
        The four corners pin the image. Edge points bend the edges to fit curved or uneven shapes:
        double-click an edge to add one there, or select one and press Delete to remove it.
      </div>
    </div>
  )
}
