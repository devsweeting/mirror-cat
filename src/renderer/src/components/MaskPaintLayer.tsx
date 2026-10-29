import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Surface } from '@shared/types'
import { writeWarpGrid } from '@shared/surfaceGeometry'
import { WARP_SEGMENTS, dedupeOutline, outlineToContent, pickWarpGrid } from '@shared/warpPick'
import {
  addDraftPoint,
  beginStroke,
  endStroke,
  fillOutline,
  stampBrush,
  strokeChanged,
  useMaskPaint,
  type ScreenPoint
} from '../state/maskPaint'

interface MaskPaintLayerProps {
  surface: Surface
  /** Pointer position in the surface container's content box, plus its size. */
  toLocal: (event: PointerEvent<HTMLElement>) => {
    x: number
    y: number
    width: number
    height: number
  }
}

/** How close (px) a click must be to the first point to close the outline. */
const CLOSE_RADIUS = 10

/** The surface's mesh positions at the current stage size (what's drawn). */
function meshPositions(surface: Surface, width: number, height: number): Float32Array {
  const rows = WARP_SEGMENTS + 1
  const grid = new Float32Array(rows * rows * 3)
  writeWarpGrid(surface.corners, surface.edgeNodes, WARP_SEGMENTS, width, height, grid, surface.warp)
  return grid
}

/**
 * Transparent layer over the selected surface in mask mode. Turns clicks
 * (Outline) or drags (Brush) into edits of the mask canvas, in the
 * surface's content space -- inverting the very mesh the engine draws, so
 * edits land exactly under the cursor in any warp mode.
 */
export default function MaskPaintLayer({ surface, toLocal }: MaskPaintLayerProps) {
  const tool = useMaskPaint((s) => s.tool)
  const op = useMaskPaint((s) => s.op)
  const brush = useMaskPaint((s) => s.brush)
  const draft = useMaskPaint((s) => s.draft)
  const layerRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<ScreenPoint | null>(null)
  const stroke = useRef<{ grid: Float32Array; last: ScreenPoint } | null>(null)

  const closeOutline = useCallback(() => {
    const el = layerRef.current
    const points = dedupeOutline(useMaskPaint.getState().draft)
    if (!el || points.length < 3) return
    const grid = meshPositions(surface, el.clientWidth, el.clientHeight)
    fillOutline(outlineToContent(points, grid, WARP_SEGMENTS), useMaskPaint.getState().op)
  }, [surface])

  // Enter closes the outline (the toolbar owns Esc and Backspace).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || useMaskPaint.getState().draft.length < 3) return
      event.preventDefault()
      event.stopImmediatePropagation()
      closeOutline()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeOutline])

  const stampAt = (grid: Float32Array, x: number, y: number): void => {
    const pick = pickWarpGrid(grid, WARP_SEGMENTS, x, y)
    if (pick) stampBrush(pick, brush)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const p = toLocal(event)
    if (p.width === 0 || p.height === 0) return

    if (tool === 'outline') {
      // Clicking the first point again closes the shape.
      const first = draft[0]
      if (draft.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) <= CLOSE_RADIUS) {
        closeOutline()
        return
      }
      addDraftPoint({ x: p.x, y: p.y })
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    // The shape can't change mid-stroke (handles are hidden), so the mesh
    // positions are computed once per stroke.
    const grid = meshPositions(surface, p.width, p.height)
    beginStroke()
    stampAt(grid, p.x, p.y)
    strokeChanged()
    stroke.current = { grid, last: { x: p.x, y: p.y } }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const p = toLocal(event)
    if (tool === 'outline') {
      setHover({ x: p.x, y: p.y })
      return
    }
    const el = cursorRef.current
    if (el) {
      el.style.transform = `translate(${p.x}px, ${p.y}px)`
      el.hidden = false
    }
    const current = stroke.current
    if (!current) return
    // Fill the gap since the last event with overlapping stamps so fast
    // strokes stay continuous.
    const { last } = current
    const count = Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / Math.max(1, brush * 0.3))
    for (let i = 1; i <= count; i++) {
      const t = i / count
      stampAt(current.grid, last.x + (p.x - last.x) * t, last.y + (p.y - last.y) * t)
    }
    current.last = { x: p.x, y: p.y }
    if (count > 0) strokeChanged()
  }

  const finishStroke = (): void => {
    if (!stroke.current) return
    stroke.current = null
    endStroke()
  }

  const nearFirst =
    tool === 'outline' &&
    draft.length >= 3 &&
    hover !== null &&
    Math.hypot(hover.x - draft[0].x, hover.y - draft[0].y) <= CLOSE_RADIUS

  return (
    <div
      ref={layerRef}
      className={`mask-paint-layer tool-${tool} op-${op}`}
      data-testid="mask-paint-layer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      onLostPointerCapture={finishStroke}
      onDoubleClick={tool === 'outline' ? closeOutline : undefined}
      onPointerLeave={() => {
        setHover(null)
        if (cursorRef.current) cursorRef.current.hidden = true
      }}
    >
      {tool === 'outline' && draft.length > 0 && (
        <svg className="mask-outline-draft" aria-hidden="true">
          <polygon
            className="mask-outline-fill"
            points={[...draft, ...(hover ? [hover] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
          />
          <polyline
            className="mask-outline-line"
            points={[...draft, ...(hover && !nearFirst ? [hover] : [draft[0]])]
              .map((p) => `${p.x},${p.y}`)
              .join(' ')}
          />
          {draft.map((p, i) => (
            <circle
              key={i}
              className={`mask-outline-point${i === 0 && nearFirst ? ' closing' : ''}`}
              cx={p.x}
              cy={p.y}
              r={i === 0 && nearFirst ? 6 : 3.5}
            />
          ))}
        </svg>
      )}
      {tool === 'brush' && (
        <div
          ref={cursorRef}
          className="mask-brush-cursor"
          hidden
          style={{ width: brush * 2, height: brush * 2, margin: -brush }}
        />
      )}
    </div>
  )
}
