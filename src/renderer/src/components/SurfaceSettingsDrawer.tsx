import { useId, useState, type CSSProperties } from 'react'
import type { Surface, WarpMode } from '@shared/types'
import { useSceneStore } from '../state/sceneStore'
import { editEdgeNodes } from '../state/shapeHistory'
import {
  MAX_EDGE_NODES,
  addNodeOnLongestSegment,
  countEdgeNodes,
  removeNewestEdgeNode,
  warpFrame
} from '@shared/surfaceGeometry'
import SurfaceContentControls from './SurfaceContentControls'
import SurfaceMaskControls from './SurfaceMaskControls'

const WARP_OPTIONS: { value: WarpMode; label: string; title: string }[] = [
  {
    value: 'perspective',
    label: 'Perspective',
    title: 'A flat surface at an angle: the far side shrinks, straight lines stay straight'
  },
  { value: 'bilinear', label: 'Even', title: 'Spread the content evenly between the corners' }
]

const SHAPE_OPEN_KEY = 'mirrorcat.shapeOpen'

function readShapeOpen(): boolean {
  try {
    return localStorage.getItem(SHAPE_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeShapeOpen(open: boolean): void {
  try {
    localStorage.setItem(SHAPE_OPEN_KEY, open ? '1' : '0')
  } catch {
    // Remembering the section is a convenience; ignore storage failures.
  }
}

interface SurfaceSettingsDrawerProps {
  surface: Surface
  onFocusSurface: () => void
}

/**
 * Per-surface settings, ordered by how often you reach for them while
 * working: what's on the surface, its mask, the alignment grid, opacity.
 * How the content bends (warp mode, edge points) is folded into "Shape",
 * since corners and double-clicking the outline on the stage do most of
 * that work. Name, outline color and delete live in the row's "…" menu
 * (SurfaceMenu).
 */
export default function SurfaceSettingsDrawer({ surface, onFocusSurface }: SurfaceSettingsDrawerProps) {
  const updateSurfaceSettings = useSceneStore((s) => s.updateSurfaceSettings)
  const extraNodes = countEdgeNodes(surface.edgeNodes)
  const pointCount = surface.corners.length + extraNodes
  const baseId = useId()
  const opacityId = `${baseId}-opacity`
  const shapeId = `${baseId}-shape`
  const shapeHelpId = `${baseId}-shape-help`
  const [shapeOpen, setShapeOpen] = useState(readShapeOpen)
  const [showShapeHelp, setShowShapeHelp] = useState(false)
  const opacityPct = Math.round(surface.opacity * 100)
  // Perspective needs a convex shape; say so instead of silently looking "Even".
  const perspectiveBlocked =
    surface.warp === 'perspective' && warpFrame(surface.corners, 'perspective').homography === null
  const warpLabel = WARP_OPTIONS.find((o) => o.value === surface.warp)?.label ?? 'Even'

  const toggleShape = (): void => {
    writeShapeOpen(!shapeOpen)
    setShapeOpen(!shapeOpen)
  }

  return (
    <div className="surface-drawer">
      <SurfaceContentControls surface={surface} onFocusSurface={onFocusSurface} />

      <SurfaceMaskControls surface={surface} />

      <div className="drawer-group">
        <div className="drawer-row">
          <span className="drawer-label">Grid</span>
          <div className="segmented" role="radiogroup" aria-label="Alignment grid">
            <button
              type="button"
              role="radio"
              aria-checked={!surface.showGrid}
              onClick={() => updateSurfaceSettings(surface.id, { showGrid: false })}
            >
              Off
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={surface.showGrid}
              title="Show an alignment grid here and on the projector"
              onClick={() => updateSurfaceSettings(surface.id, { showGrid: true })}
            >
              On
            </button>
          </div>
        </div>

        <div className="drawer-row drawer-inline-slider">
          <label className="drawer-label" htmlFor={opacityId}>
            Opacity
          </label>
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
          <span className="drawer-value num">{opacityPct}%</span>
        </div>
      </div>

      <div className="drawer-section">
        <button
          type="button"
          className="drawer-disclosure"
          onClick={toggleShape}
          aria-expanded={shapeOpen}
          aria-controls={shapeId}
        >
          <span className="drawer-label">Shape</span>
          <span className="drawer-disclosure-summary">
            {warpLabel}, {pointCount} points
          </span>
          <svg
            className="drawer-disclosure-chevron"
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
          >
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {perspectiveBlocked && (
          <div className="drawer-help" role="status">
            These corners don’t make a shape a flat surface could have, so content is spread evenly
            until they do.
          </div>
        )}

        <div id={shapeId} className="drawer-section-body" hidden={!shapeOpen}>
          <div className="drawer-row">
            <span className="drawer-label label-with-info">
              Warp
              <button
                type="button"
                className="info-button"
                onClick={() => setShowShapeHelp((v) => !v)}
                aria-expanded={showShapeHelp}
                aria-controls={shapeHelpId}
                aria-label="About warp and edge points"
                title="About warp and edge points"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="8" cy="5" r="0.9" fill="currentColor" />
                  <path d="M8 7.3v4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </span>
            <div className="segmented" role="radiogroup" aria-label="Warp">
              {WARP_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={surface.warp === option.value}
                  title={option.title}
                  onClick={() => updateSurfaceSettings(surface.id, { warp: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="drawer-row">
            <span className="drawer-label">Edge points</span>
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
                {pointCount}
              </span>
              <button
                type="button"
                className="icon-btn"
                disabled={extraNodes >= MAX_EDGE_NODES}
                onClick={() =>
                  editEdgeNodes(
                    surface.id,
                    addNodeOnLongestSegment(surface.corners, surface.edgeNodes, 1, surface.warp)
                  )
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

          <div id={shapeHelpId} className="drawer-help" hidden={!showShapeHelp}>
            Perspective is for flat surfaces at an angle to the projector, like a wall or the side
            of a box: the far side shrinks the way it does in real life. Even spreads content evenly
            between the corners. Edge points bend the edges to fit curved or uneven shapes:
            double-click the outline on the stage to add one there, or select one and press Delete.
          </div>
        </div>
      </div>
    </div>
  )
}
