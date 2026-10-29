import type { CornerSet } from './types'
import { applyHomography, squareToQuad } from './surfaceGeometry'
import { invertHomography, type Point } from './homography'

/**
 * Shapes found in a scan photo that's been fitted to the projector frame.
 *
 * - `quad`: a flat, four-sided face (a frame, door, box side, panel). Its
 *   corners are the surface's corners; no mask is needed.
 * - `outline`: anything else. The surface's corners are a rectangle fitted
 *   around it and an exact mask (made in main from the shape's pixels)
 *   trims it to the shape.
 *
 * Coordinates are 0..1 across the frame, so they're surface corners as-is.
 */
export type ShapeKind = 'quad' | 'outline'

export interface DetectedShape {
  id: string
  kind: ShapeKind
  /** Fitted surface corners: top-left, top-right, bottom-right, bottom-left. */
  corners: CornerSet
  /** The shape's outline, for drawing (the biggest piece when there are several). */
  outline: Point[]
  /** Every piece's outline, when combined shapes don't touch. */
  rings?: Point[][]
  /** Share of the frame it covers, 0..1. */
  area: number
}

/** Most shapes offered at once; past this the picker gets noisy. */
export const MAX_SHAPES = 16

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Convex hull (Andrew's monotone chain). Duplicates and collinear points dropped. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return sorted
  const lower: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Unsigned area of a simple polygon. */
export function polygonArea(points: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/** Indices of the open polyline points kept by Douglas–Peucker (ends included). */
function douglasPeucker(points: readonly Point[], epsilon: number): number[] {
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [from, to] = stack.pop()!
    let worst = -1
    let worstDist = epsilon
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistance(points[i], points[from], points[to])
      if (d > worstDist) {
        worstDist = d
        worst = i
      }
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([from, worst], [worst, to])
    }
  }
  const out: number[] = []
  keep.forEach((k, i) => k && out.push(i))
  return out
}

/**
 * Simplify a closed outline: split it at its two farthest-apart points
 * (so the split can't land mid-edge on a box) and simplify each half.
 */
export function simplifyClosed(points: readonly Point[], epsilon: number): Point[] {
  if (points.length <= 4) return [...points]
  let far = 0
  let farDist = -1
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y)
    if (d > farDist) {
      farDist = d
      far = i
    }
  }
  const first = points.slice(0, far + 1)
  const second = [...points.slice(far), points[0]]
  const a = douglasPeucker(first, epsilon).map((i) => first[i])
  const b = douglasPeucker(second, epsilon).map((i) => second[i])
  return a.concat(b.slice(1, -1))
}

/** Least-squares line through points: a point on it and its direction. */
function fitLine(points: readonly Point[]): { p: Point; d: Point } | null {
  if (points.length < 2) return null
  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  cx /= points.length
  cy /= points.length
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of points) {
    const dx = p.x - cx
    const dy = p.y - cy
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { p: { x: cx, y: cy }, d: { x: Math.cos(angle), y: Math.sin(angle) } }
}

function intersect(a: { p: Point; d: Point }, b: { p: Point; d: Point }): Point | null {
  const det = a.d.x * b.d.y - a.d.y * b.d.x
  if (Math.abs(det) < 1e-9) return null
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / det
  return { x: a.p.x + t * a.d.x, y: a.p.y + t * a.d.y }
}

/**
 * Four corners for a hull that's close to a four-sided shape, or null.
 *
 * Douglas–Peucker with a growing tolerance until four points are left,
 * then each side is refit as a line through the outline points along it
 * (ignoring the rounded bits near the corners) and neighbouring sides are
 * intersected -- so a slightly rounded corner still gets a sharp one.
 * `outline` is the dense boundary the hull came from (or the hull itself).
 */
export function fitQuad(hull: readonly Point[], outline: readonly Point[] = hull): Point[] | null {
  if (hull.length < 4) return null
  let size = 0
  for (const p of hull) for (const q of hull) size = Math.max(size, Math.hypot(p.x - q.x, p.y - q.y))
  let quad: Point[] | null = null
  for (let eps = size * 0.005; eps < size * 0.25; eps *= 1.25) {
    const simplified = simplifyClosed(hull, eps)
    if (simplified.length === 4) {
      quad = simplified
      break
    }
    if (simplified.length < 4) return null
  }
  if (!quad) return null

  // Refit each side through the outline points lying along it.
  const lines = quad.map((a, i) => {
    const b = quad![(i + 1) % 4]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const near = outline.filter((p) => {
      if (segmentDistance(p, a, b) > Math.max(1.5, len * 0.03)) return false
      const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)
      return t > 0.15 && t < 0.85
    })
    return (near.length >= 3 && fitLine(near)) || { p: a, d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } }
  })
  return quad.map((corner, i) => {
    const hit = intersect(lines[(i + 3) % 4], lines[i])
    // A refit that moves a corner far (nearly parallel sides) isn't trusted.
    return hit && Math.hypot(hit.x - corner.x, hit.y - corner.y) < size * 0.08 ? hit : corner
  })
}

/** Smallest-area rectangle around a convex hull (rotating calipers, brute force). */
export function minAreaRect(hull: readonly Point[]): Point[] {
  if (hull.length === 0) return [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]
  let best: Point[] | null = null
  let bestArea = Infinity
  for (let i = 0; i < Math.max(1, hull.length); i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const ux = len > 0 ? (b.x - a.x) / len : 1
    const uy = len > 0 ? (b.y - a.y) / len : 0
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const p of hull) {
      const u = p.x * ux + p.y * uy
      const v = -p.x * uy + p.y * ux
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area < bestArea) {
      bestArea = area
      const at = (u: number, v: number): Point => ({ x: u * ux - v * uy, y: u * uy + v * ux })
      best = [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)]
    }
  }
  return best!
}

/**
 * Four corners in surface order -- top-left, top-right, bottom-right,
 * bottom-left (clockwise on screen, y down). Starts from the corner
 * nearest the top-left.
 */
export function orderCorners(points: readonly Point[]): CornerSet {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  const byAngle = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  )
  let start = 0
  byAngle.forEach((p, i) => {
    if (p.x + p.y < byAngle[start].x + byAngle[start].y) start = i
  })
  const ordered = [0, 1, 2, 3].map((i) => byAngle[(start + i) % 4])
  return ordered.map((p) => ({ x: p.x, y: p.y })) as CornerSet
}

export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Frame points (0..1) into a surface's own content space (u across, v
 * down, 0..1 inside it) for a perspective surface with these corners.
 * Null when the corners don't make a usable shape.
 */
export function frameToSurface(
  points: readonly Point[],
  corners: CornerSet
): { u: number; v: number }[] | null {
  const forward = squareToQuad(corners)
  const inverse = forward && invertHomography(forward)
  if (!inverse) return null
  return points.map((p) => {
    const { x, y } = applyHomography(inverse, p.x, p.y)
    return { u: x, v: y }
  })
}

/** The topmost (smallest) shape under a point, for clicks on overlapping shapes. */
export function shapeAt(shapes: readonly DetectedShape[], p: Point): DetectedShape | null {
  let hit: DetectedShape | null = null
  for (const shape of shapes) {
    const inside = (shape.rings ?? [shape.outline]).some((ring) => pointInPolygon(p, ring))
    if (inside && (!hit || shape.area < hit.area)) hit = shape
  }
  return hit
}
