import type { CornerSet, EdgeNode, EdgeNodeSet } from './types'

/**
 * Shift-drag on a corner: the surface becomes an upright rectangle with a
 * fixed aspect ratio (the media's), anchored at the opposite corner. With
 * the shape matching the media, the corner-pin "warp" is a pure scale, so
 * the image resizes instead of distorting.
 *
 * All maths is in projector *pixels* -- a 16:9 rectangle has to be 16:9 on
 * the wall, not in normalized 0..1 units -- and converted back at the end.
 * Pure functions, no DOM, so they're unit-testable like surfaceGeometry.
 */

interface Point {
  x: number
  y: number
}

/** Smallest rectangle side, in pixels, so a surface can't collapse to nothing. */
const MIN_SIDE_PX = 16

/**
 * Which way each corner sits from its opposite corner, by index
 * (TL, TR, BR, BL): TL grows up-left from BR, TR up-right from BL, etc.
 */
const GROW_DIRECTION: readonly [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1]
]

/**
 * Corners (TL, TR, BR, BL, normalized) of an `aspect`-shaped upright
 * rectangle: the corner opposite `cornerIndex` is fixed at `anchor`, and
 * corner `cornerIndex` follows `pointer`. Like Shift-resize in design
 * tools, the larger of the two pointer offsets drives the size.
 *
 * The growth direction comes from which corner is dragged, not from where
 * the pointer is. So the dragged corner stays the one under the cursor
 * (its index never changes) and the media can never be mirrored: dragging
 * past the anchor just bottoms out at the minimum size. The rectangle is
 * clamped to stay inside the frame.
 *
 * `anchor` and `pointer` are normalized (0..1); width/height are the frame
 * size in pixels.
 */
export function proportionalCorners(
  cornerIndex: number,
  anchor: Point,
  pointer: Point,
  aspect: number,
  width: number,
  height: number
): CornerSet {
  const ax = anchor.x * width
  const ay = anchor.y * height
  const dx = pointer.x * width - ax
  const dy = pointer.y * height - ay
  const [sx, sy] = GROW_DIRECTION[cornerIndex % 4]

  let w = Math.max(sx * dx, sy * dy * aspect, MIN_SIDE_PX)
  // Room left in the growth direction before hitting the frame edge.
  const roomX = sx > 0 ? width - ax : ax
  const roomY = sy > 0 ? height - ay : ay
  w = Math.min(w, roomX, roomY * aspect)
  const h = w / aspect

  const x1 = ax
  const x2 = ax + sx * w
  const y1 = ay
  const y2 = ay + sy * h
  const left = Math.min(x1, x2) / width
  const right = Math.max(x1, x2) / width
  const top = Math.min(y1, y2) / height
  const bottom = Math.max(y1, y2) / height
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ]
}

/**
 * The shape's current proportions in pixels (average width over average
 * height), used when there's no media to take an aspect ratio from.
 */
export function cornersAspect(corners: CornerSet, width: number, height: number): number {
  const p = corners.map((c) => ({ x: c.x * width, y: c.y * height }))
  const across = dist(p[0], p[1]) + dist(p[3], p[2])
  const down = dist(p[0], p[3]) + dist(p[1], p[2])
  return down > 0 && across > 0 ? across / down : 1
}

/**
 * Each edge node described relative to its edge's straight chord: how far
 * along it (s, 0..1) and how far off it (d, as a fraction of the chord's
 * length, signed). Captured once when Shift-drag starts, so repeated moves
 * re-derive from the original bends instead of compounding rounding.
 */
export type EdgeNodeFrames = { id: string; edge: number; s: number; d: number }[]

export function captureEdgeNodeFrames(
  corners: CornerSet,
  edgeNodes: EdgeNodeSet,
  width: number,
  height: number
): EdgeNodeFrames {
  const frames: EdgeNodeFrames = []
  edgeNodes.forEach((nodes, edge) => {
    const a = toPx(corners[edge], width, height)
    const b = toPx(corners[(edge + 1) % 4], width, height)
    const len = dist(a, b)
    if (len === 0) return
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    for (const node of nodes) {
      const p = toPx(node, width, height)
      const rx = p.x - a.x
      const ry = p.y - a.y
      frames.push({
        id: node.id,
        edge,
        s: (rx * ux + ry * uy) / len,
        // Perpendicular (left-hand normal) offset, relative to chord length.
        d: (rx * -uy + ry * ux) / len
      })
    }
  })
  return frames
}

/**
 * Re-place edge nodes on new corners so each bend keeps its shape relative
 * to its edge -- i.e. the bends scale with the surface. Node ids, `t` and
 * order are untouched; only x/y move.
 */
export function applyEdgeNodeFrames(
  edgeNodes: EdgeNodeSet,
  frames: EdgeNodeFrames,
  corners: CornerSet,
  width: number,
  height: number
): EdgeNodeSet {
  const byId = new Map(frames.map((f) => [f.id, f]))
  return edgeNodes.map((nodes, edge) => {
    const a = toPx(corners[edge], width, height)
    const b = toPx(corners[(edge + 1) % 4], width, height)
    const len = dist(a, b)
    const ux = len > 0 ? (b.x - a.x) / len : 0
    const uy = len > 0 ? (b.y - a.y) / len : 0
    return nodes.map((node): EdgeNode => {
      const f = byId.get(node.id)
      if (!f || f.edge !== edge) return node
      const px = a.x + f.s * len * ux + f.d * len * -uy
      const py = a.y + f.s * len * uy + f.d * len * ux
      return { ...node, x: clamp01(px / width), y: clamp01(py / height) }
    })
  }) as EdgeNodeSet
}

/** "16:9", "4:3", "1:1", or "1.85:1" for ratios without a small whole form. */
export function aspectLabel(aspect: number): string {
  for (let h = 1; h <= 16; h++) {
    const w = Math.round(aspect * h)
    // Within 0.2%: 1920×1080 → "16:9", but 2.39 stays "2.39:1", not "12:5".
    if (w >= 1 && w <= 32 && Math.abs(w / h - aspect) / aspect < 0.002) return `${w}:${h}`
  }
  return `${aspect.toFixed(2)}:1`
}

function toPx(p: Point, width: number, height: number): Point {
  return { x: p.x * width, y: p.y * height }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
