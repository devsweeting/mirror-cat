import { useMemo, useState, type MouseEvent } from 'react'
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
}

function centre(shape: DetectedShape): { x: number; y: number } {
  const pts = shape.outline
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length
  }
}

/**
 * The fitted scan with every found shape outlined. Click a shape (or its
 * row) to pick it; each picked shape becomes a surface -- a new one, or an
 * existing surface moved onto it. The list is the keyboard-friendly way in.
 */
export default function ShapePicker({
  imageUrl,
  shapes,
  picks,
  surfaces,
  onToggle,
  onTarget,
  onPickAll
}: ShapePickerProps) {
  const [aspect, setAspect] = useState(16 / 9)
  const [hovered, setHovered] = useState<string | null>(null)
  // Big shapes underneath, small ones on top, so inner shapes stay clickable.
  const layered = useMemo(() => [...shapes].sort((a, b) => b.area - a.area), [shapes])
  const pickedCount = shapes.filter((s) => picks[s.id]).length

  const pointAt = (event: MouseEvent<HTMLDivElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  return (
    <div className="shape-picker">
      <div className="shape-stage-wrap">
        <div
          className={`shape-stage${hovered ? ' over-shape' : ''}`}
          style={{ aspectRatio: String(aspect) }}
          onClick={(event) => {
            const hit = shapeAt(shapes, pointAt(event))
            if (hit) onToggle(hit.id)
          }}
          onMouseMove={(event) => setHovered(shapeAt(shapes, pointAt(event))?.id ?? null)}
          onMouseLeave={() => setHovered(null)}
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
            const c = centre(shape)
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
        </div>
      </div>

      <div className="shape-list-wrap">
        <div className="shape-list-head">
          <span>
            {pickedCount} of {shapes.length} picked
          </span>
          <button type="button" className="link-btn" onClick={() => onPickAll(pickedCount < shapes.length)}>
            {pickedCount < shapes.length ? 'Pick all' : 'Pick none'}
          </button>
        </div>
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
      </div>
    </div>
  )
}
