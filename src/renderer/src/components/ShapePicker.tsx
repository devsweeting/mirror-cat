import { useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import type { FrameBox } from '@shared/sam'
import { shapeAt, shapeNumber, type DetectedShape } from '@shared/shapes'

/** Where a picked shape goes: a new surface, or an existing surface's id. */
export type ShapeTarget = 'new' | string

interface ShapePickerProps {
  imageUrl: string
  shapes: DetectedShape[]
  /** Picked shapes and where each goes; a shape that's not here isn't picked. */
  picks: Record<string, ShapeTarget>
  surfaces: { id: string; name: string }[]
  onToggle: (shapeId: string) => void
  onTarget: (shapeId: string, target: ShapeTarget) => void
  onPickAll: (all: boolean) => void
  /** A box was drawn around something on the photo. */
  onBox: (box: FrameBox) => void
  /** A box being searched right now (drawn pulsing until it's answered). */
  pendingBox: FrameBox | null
  /** Shown under the list: the detailed finder. */
  footer?: ReactNode
}

/** How far (px) a press must move before it's a box rather than a click. */
const DRAG_PX = 6

function centre(shape: DetectedShape): { x: number; y: number } {
  const pts = shape.outline
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length
  }
}

/** A badge's size as a share of the stage (about 26 px on a ~560 px stage). */
const BADGE = 0.047

/**
 * Where each shape's number goes: its centre, unless that's on top of a
 * bigger shape's number (a frame and the picture in it share a centre) --
 * then it steps down until it's clear.
 */
function badgePositions(shapes: DetectedShape[], aspect: number): Map<string, { x: number; y: number }> {
  const placed = new Map<string, { x: number; y: number }>()
  const step = BADGE * aspect
  for (const shape of [...shapes].sort((a, b) => b.area - a.area)) {
    const p = centre(shape)
    for (let tries = 0; tries < 8; tries++) {
      const clash = [...placed.values()].some((q) => Math.abs(q.x - p.x) < BADGE && Math.abs(q.y - p.y) < step)
      if (!clash) break
      p.y = Math.min(1 - step / 2, p.y + step)
    }
    placed.set(shape.id, p)
  }
  return placed
}

function boxStyle(box: FrameBox): CSSProperties {
  return {
    left: `${box.x0 * 100}%`,
    top: `${box.y0 * 100}%`,
    width: `${(box.x1 - box.x0) * 100}%`,
    height: `${(box.y1 - box.y0) * 100}%`
  }
}

/**
 * The fitted scan with every found shape outlined. Click a shape (or its
 * row) to pick it; drag a box around anything that wasn't found, or to say
 * "this one, not the bit inside it". Each picked shape becomes a surface:
 * a new one, or an existing surface moved onto it. The list is the
 * keyboard-friendly way in.
 */
export default function ShapePicker({
  imageUrl,
  shapes,
  picks,
  surfaces,
  onToggle,
  onTarget,
  onPickAll,
  onBox,
  pendingBox,
  footer
}: ShapePickerProps) {
  const [aspect, setAspect] = useState(16 / 9)
  const [hovered, setHovered] = useState<string | null>(null)
  const [draft, setDraft] = useState<FrameBox | null>(null)
  const press = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null)
  // Big shapes underneath, small ones on top, so inner shapes stay clickable.
  const layered = useMemo(() => [...shapes].sort((a, b) => b.area - a.area), [shapes])
  const pickedCount = shapes.filter((s) => picks[s.id]).length
  const badges = useMemo(() => badgePositions(shapes, aspect), [shapes, aspect])

  const pointAt = (event: PointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    }
  }

  const handleDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const p = pointAt(event)
    press.current = { ...p, px: event.clientX, py: event.clientY, moved: false }
  }

  const handleMove = (event: PointerEvent<HTMLDivElement>): void => {
    const p = pointAt(event)
    const start = press.current
    if (!start) {
      setHovered(shapeAt(shapes, p)?.id ?? null)
      return
    }
    if (!start.moved && Math.hypot(event.clientX - start.px, event.clientY - start.py) < DRAG_PX) return
    start.moved = true
    setHovered(null)
    setDraft({
      x0: Math.min(start.x, p.x),
      y0: Math.min(start.y, p.y),
      x1: Math.max(start.x, p.x),
      y1: Math.max(start.y, p.y)
    })
  }

  const handleUp = (): void => {
    const start = press.current
    press.current = null
    if (!start) return
    if (start.moved) {
      if (draft && draft.x1 - draft.x0 > 0.01 && draft.y1 - draft.y0 > 0.01) onBox(draft)
      setDraft(null)
      return
    }
    const hit = shapeAt(shapes, start)
    if (hit) onToggle(hit.id)
  }

  const shownBox = draft ?? pendingBox

  return (
    <div className="shape-picker">
      <div className="shape-stage-wrap">
        <div
          className={`shape-stage${hovered ? ' over-shape' : ''}`}
          style={{ aspectRatio: String(aspect) }}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={() => {
            press.current = null
            setDraft(null)
          }}
          onPointerLeave={() => !press.current && setHovered(null)}
          data-testid="shape-stage"
        >
          <img
            src={imageUrl}
            alt="Your scan, fitted to the projector"
            draggable={false}
            onLoad={(event) => {
              const img = event.currentTarget
              if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight)
            }}
          />
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            {layered.map((shape) => {
              const points = shape.outline.map((p) => `${p.x},${p.y}`).join(' ')
              const cls = `shape-outline${picks[shape.id] ? ' picked' : ''}${hovered === shape.id ? ' hovered' : ''}`
              return (
                <g key={shape.id} className={cls}>
                  <polygon points={points} className="shape-fill" />
                  <polygon points={points} className="shape-halo" vectorEffect="non-scaling-stroke" />
                  <polygon points={points} className="shape-line" vectorEffect="non-scaling-stroke" />
                </g>
              )
            })}
          </svg>
          {shapes.map((shape) => {
            const c = badges.get(shape.id) ?? centre(shape)
            return (
              <span
                key={shape.id}
                className={`shape-badge${picks[shape.id] ? ' picked' : ''}`}
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                aria-hidden="true"
              >
                {shapeNumber(shape)}
              </span>
            )
          })}
          {shownBox && (
            <div
              className={`shape-box${!draft && pendingBox ? ' searching' : ''}`}
              style={boxStyle(shownBox)}
              aria-hidden="true"
            />
          )}
        </div>
        <p className="shape-hint">Click a shape to pick it. Drag a box around anything it missed.</p>
      </div>

      <div className="shape-list-wrap">
        {shapes.length > 0 ? (
          <div className="shape-list-head">
            <span>
              {pickedCount} of {shapes.length} picked
            </span>
            <span className="shape-list-actions">
              <button
                type="button"
                className="link-btn"
                onClick={() => onPickAll(true)}
                disabled={pickedCount === shapes.length}
                aria-label="Pick all shapes"
              >
                All
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => onPickAll(false)}
                disabled={pickedCount === 0}
                aria-label="Pick no shapes"
              >
                None
              </button>
            </span>
          </div>
        ) : (
          <p className="shape-empty">No shapes yet. Drag a box around something on the photo.</p>
        )}
        <ul className="shape-list">
          {shapes.map((shape) => {
            const n = shapeNumber(shape)
            const target = picks[shape.id]
            return (
              <li
                key={shape.id}
                className={`${target ? 'picked' : ''}${hovered === shape.id ? ' hovered' : ''}`}
                onMouseEnter={() => setHovered(shape.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={Boolean(target)}
                  className="shape-row"
                  onClick={() => onToggle(shape.id)}
                >
                  <span className="shape-num" aria-hidden="true">
                    {n}
                  </span>
                  <span className="shape-row-text">
                    <span className="shape-row-name">Shape {n}</span>
                    <span className="shape-row-kind">
                      {shape.kind === 'quad' ? 'Four corners' : 'Traced outline'}
                    </span>
                  </span>
                </button>
                {target && (
                  <select
                    className="shape-target"
                    aria-label={`Where shape ${n} goes`}
                    value={target}
                    onChange={(event) => onTarget(shape.id, event.target.value)}
                  >
                    <option value="new">New surface</option>
                    {surfaces.map((s) => (
                      <option key={s.id} value={s.id}>
                        Move {s.name} here
                      </option>
                    ))}
                  </select>
                )}
              </li>
            )
          })}
        </ul>
        {footer}
      </div>
    </div>
  )
}
