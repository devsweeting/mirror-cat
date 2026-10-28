import { useCallback, useRef, type PointerEvent } from 'react'
import type { Surface } from '@shared/types'
import { writeWarpGrid } from '@shared/surfaceGeometry'
import { WARP_SEGMENTS, pickWarpGrid } from '@shared/warpPick'
import {
  beginStroke,
  endStroke,
  stampBrush,
  strokeChanged,
  useMaskPaint
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

/**
 * Transparent layer over the selected surface while its mask is being
 * painted. Turns pointer drags into brush stamps on the paint canvas, in
 * the surface's content space -- inverting the very mesh the engine draws,
 * so the stroke lands exactly under the cursor in any warp mode.
 */
export default function MaskPaintLayer({ surface, toLocal }: MaskPaintLayerProps) {
  const brush = useMaskPaint((s) => s.brush)
  const tool = useMaskPaint((s) => s.tool)
  const cursorRef = useRef<HTMLDivElement>(null)
  const stroke = useRef<{ grid: Float32Array; last: { x: number; y: number } } | null>(null)

  const stampAt = useCallback(
    (grid: Float32Array, x: number, y: number) => {
      const pick = pickWarpGrid(grid, WARP_SEGMENTS, x, y)
      if (pick) stampBrush(pick, brush)
    },
    [brush]
  )

  const moveCursor = (x: number, y: number): void => {
    const el = cursorRef.current
    if (!el) return
    el.style.transform = `translate(${x}px, ${y}px)`
    el.hidden = false
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = toLocal(event)
    if (p.width === 0 || p.height === 0) return
    // The shape can't change mid-stroke (handles are hidden), so the mesh
    // positions are computed once per stroke.
    const rows = WARP_SEGMENTS + 1
    const grid = new Float32Array(rows * rows * 3)
    writeWarpGrid(
      surface.corners,
      surface.edgeNodes,
      WARP_SEGMENTS,
      p.width,
      p.height,
      grid,
      surface.warp
    )
    beginStroke()
    stampAt(grid, p.x, p.y)
    strokeChanged()
    stroke.current = { grid, last: { x: p.x, y: p.y } }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const p = toLocal(event)
    moveCursor(p.x, p.y)
    const current = stroke.current
    if (!current) return
    // Fill the gap since the last event with overlapping stamps so fast
    // strokes stay continuous.
    const { last } = current
    const distance = Math.hypot(p.x - last.x, p.y - last.y)
    const step = Math.max(1, brush * 0.3)
    const count = Math.ceil(distance / step)
    for (let i = 1; i <= count; i++) {
      const t = i / count
      stampAt(current.grid, last.x + (p.x - last.x) * t, last.y + (p.y - last.y) * t)
    }
    current.last = { x: p.x, y: p.y }
    if (count > 0) strokeChanged()
  }

  const finish = (): void => {
    if (!stroke.current) return
    stroke.current = null
    endStroke()
  }

  return (
    <div
      className={`mask-paint-layer tool-${tool}`}
      data-testid="mask-paint-layer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onPointerLeave={() => {
        if (cursorRef.current) cursorRef.current.hidden = true
      }}
    >
      <div
        ref={cursorRef}
        className="mask-brush-cursor"
        hidden
        style={{ width: brush * 2, height: brush * 2, margin: -brush }}
      />
    </div>
  )
}
