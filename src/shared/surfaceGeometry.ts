import type { CornerSet, EdgeNode, EdgeNodeSet, WarpMode } from './types'

/** Upper bound on extra nodes per surface; keeps the warp mesh able to resolve them. */
export const MAX_EDGE_NODES = 24

/** Nodes closer than this along an edge (in content space) are refused. */
const MIN_T_GAP = 0.01

export interface EdgePoint {
  x: number
  y: number
  /** 0..1 along the edge in content space. */
  t: number
  /** null for the edge's start/end corners. */
  nodeId: string | null
}

export interface BoundaryPoint extends EdgePoint {
  edge: number
}

/** Start corner, nodes (by t), end corner for one edge, in edge direction. */
export function edgePoints(corners: CornerSet, edgeNodes: EdgeNodeSet, edge: number): EdgePoint[] {
  const a = corners[edge]
  const b = corners[(edge + 1) % 4]
  return [
    { x: a.x, y: a.y, t: 0, nodeId: null },
    ...edgeNodes[edge].map((n) => ({ x: n.x, y: n.y, t: n.t, nodeId: n.id })),
    { x: b.x, y: b.y, t: 1, nodeId: null }
  ]
}

/** The closed outline: every corner and node once, clockwise from top-left. */
export function boundaryPoints(corners: CornerSet, edgeNodes: EdgeNodeSet): BoundaryPoint[] {
  const out: BoundaryPoint[] = []
  for (let edge = 0; edge < 4; edge++) {
    const pts = edgePoints(corners, edgeNodes, edge)
    for (let i = 0; i < pts.length - 1; i++) out.push({ ...pts[i], edge })
  }
  return out
}

/**
 * Point on a piecewise-linear edge at content parameter s (0..1).
 *
 * `wa` / `wb` are the perspective weights of the edge's start and end
 * corners (see warpFrame). With both 1 -- the bilinear warp -- content is
 * spread evenly along each segment. Otherwise it's spread the way a flat
 * plane at an angle would show it: bunched up towards the far corner.
 */
export function evalEdge(points: EdgePoint[], s: number, wa = 1, wb = 1): { x: number; y: number } {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (s <= b.t || i === points.length - 2) {
      const fa = perspectiveFraction(a.t, wa, wb)
      const span = perspectiveFraction(b.t, wa, wb) - fa
      const k = span > 0 ? (perspectiveFraction(s, wa, wb) - fa) / span : 0
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
  }
  return { x: points[0].x, y: points[0].y }
}

// ---------------------------------------------------------------------------
// Perspective (homography) warp
// ---------------------------------------------------------------------------

/**
 * Projective map from the unit square (content u, v) to the surface's
 * corners (normalized frame coordinates):
 *
 *   x = (a·u + b·v + c) / (g·u + h·v + 1)
 *   y = (d·u + e·v + f) / (g·u + h·v + 1)
 *
 * (0,0)→TL, (1,0)→TR, (1,1)→BR, (0,1)→BL.
 */
export interface Homography {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  g: number
  h: number
}

/** Below this (normalized units²) a corner turn counts as a straight line. */
const CONVEX_EPS = 1e-7

/**
 * True when the four corners make a convex shape with no straight or
 * reflex angles -- the only shapes a flat rectangle seen at an angle can
 * make. Dragging one corner past the diagonal (a concave "dart") or across
 * an edge (a bow-tie) has no perspective interpretation.
 */
export function isConvexQuad(corners: CornerSet): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % 4]
    const c = corners[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < CONVEX_EPS) return false
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * The unit-square → corners homography (Heckbert's closed form), or null
 * when the corners aren't convex.
 */
export function squareToQuad(corners: CornerSet): Homography | null {
  if (!isConvexQuad(corners)) return null
  const [p0, p1, p2, p3] = corners
  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const dy3 = p0.y - p1.y + p2.y - p3.y
  let g = 0
  let h = 0
  // A parallelogram is an affine map (no foreshortening); g = h = 0.
  if (dx3 !== 0 || dy3 !== 0) {
    const det = dx1 * dy2 - dx2 * dy1
    if (det === 0) return null
    g = (dx3 * dy2 - dx2 * dy3) / det
    h = (dx1 * dy3 - dx3 * dy1) / det
  }
  const homography = {
    a: p1.x - p0.x + g * p1.x,
    b: p3.x - p0.x + h * p3.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p3.y - p0.y + h * p3.y,
    f: p0.y,
    g,
    h
  }
  // Convex corners always give positive weights; this guards float edge cases.
  return cornerWeights(homography).every((w) => w > 1e-6 && Number.isFinite(w)) ? homography : null
}

export function applyHomography(m: Homography, u: number, v: number): { x: number; y: number } {
  const w = m.g * u + m.h * v + 1
  return { x: (m.a * u + m.b * v + m.c) / w, y: (m.d * u + m.e * v + m.f) / w }
}

/**
 * The homography's denominator at TL, TR, BR, BL. Relative depth, in
 * effect: a corner with a bigger weight is "further away", so content
 * bunches up towards it.
 */
function cornerWeights(m: Homography): [number, number, number, number] {
  return [1, 1 + m.g, 1 + m.g + m.h, 1 + m.h]
}

/**
 * How far along a straight perspective edge (0..1, in the frame) content
 * parameter s lands, given the edge's end weights. Identity when wa = wb.
 */
function perspectiveFraction(s: number, wa: number, wb: number): number {
  if (wa === wb) return s
  return (s * wb) / ((1 - s) * wa + s * wb)
}

/** Inverse of perspectiveFraction. */
function inversePerspectiveFraction(f: number, wa: number, wb: number): number {
  if (wa === wb) return f
  return (f * wa) / (f * wa + (1 - f) * wb)
}

export interface WarpFrame {
  /** Set when the perspective warp is in effect; null means bilinear. */
  homography: Homography | null
  /** Perspective weight of each corner (all 1 for bilinear). */
  weights: [number, number, number, number]
}

/**
 * What a surface's warp actually is right now: perspective only when asked
 * for *and* the corners allow it.
 */
export function warpFrame(corners: CornerSet, warp: WarpMode): WarpFrame {
  if (warp === 'perspective') {
    const homography = squareToQuad(corners)
    if (homography) return { homography, weights: cornerWeights(homography) }
  }
  return { homography: null, weights: [1, 1, 1, 1] }
}

/**
 * Content parameter for a point a fraction `k` of the way (in the frame)
 * along the outline segment from content parameter `ta` to `tb` on `edge`.
 * Used when inserting a node on a segment, so the node lands on exactly the
 * slice of content already shown there and adding it doesn't move anything.
 */
export function segmentContentParam(
  corners: CornerSet,
  warp: WarpMode,
  edge: number,
  ta: number,
  tb: number,
  k: number
): number {
  const { weights } = warpFrame(corners, warp)
  const wa = weights[edge]
  const wb = weights[(edge + 1) % 4]
  const fa = perspectiveFraction(ta, wa, wb)
  const fb = perspectiveFraction(tb, wa, wb)
  return inversePerspectiveFraction(fa + (fb - fa) * k, wa, wb)
}

export function countEdgeNodes(edgeNodes: EdgeNodeSet): number {
  return edgeNodes.reduce((sum, nodes) => sum + nodes.length, 0)
}

/**
 * Inserts a node on `edge` at content parameter `t`, landing at (x, y).
 * Returns the set unchanged if the surface is at its node limit or `t` would
 * crowd an existing point on that edge.
 */
export function insertEdgeNode(
  edgeNodes: EdgeNodeSet,
  edge: number,
  t: number,
  x: number,
  y: number
): EdgeNodeSet {
  if (countEdgeNodes(edgeNodes) >= MAX_EDGE_NODES) return edgeNodes
  const existing = edgeNodes[edge]
  const tooClose =
    t < MIN_T_GAP || t > 1 - MIN_T_GAP || existing.some((n) => Math.abs(n.t - t) < MIN_T_GAP)
  if (tooClose) return edgeNodes

  const seq = Math.max(0, ...edgeNodes.flat().map((n) => n.seq)) + 1
  const node: EdgeNode = { id: `node-${seq}`, seq, t, x, y }
  const next = edgeNodes.map((nodes) => nodes) as EdgeNodeSet
  next[edge] = [...existing, node].sort((a, b) => a.t - b.t)
  return next
}

/**
 * Adds a node at the midpoint of the longest outline segment. Because it
 * sits exactly on the existing straight segment, at the slice of content
 * already shown there, adding it never changes the shape or the warp -- it
 * just gives you a new point to drag.
 *
 * `aspect` (frame width / height) weights horizontal length so "longest"
 * matches what you see; 1 is fine when the frame shape isn't known.
 */
export function addNodeOnLongestSegment(
  corners: CornerSet,
  edgeNodes: EdgeNodeSet,
  aspect = 1,
  warp: WarpMode = 'bilinear'
): EdgeNodeSet {
  let best: { edge: number; a: EdgePoint; b: EdgePoint; len: number } | null = null
  for (let edge = 0; edge < 4; edge++) {
    const pts = edgePoints(corners, edgeNodes, edge)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      if (b.t - a.t < MIN_T_GAP * 2) continue
      const len = Math.hypot((b.x - a.x) * aspect, b.y - a.y)
      if (!best || len > best.len) best = { edge, a, b, len }
    }
  }
  if (!best) return edgeNodes
  const { edge, a, b } = best
  const t = segmentContentParam(corners, warp, edge, a.t, b.t, 0.5)
  return insertEdgeNode(edgeNodes, edge, t, (a.x + b.x) / 2, (a.y + b.y) / 2)
}

export function moveEdgeNode(
  edgeNodes: EdgeNodeSet,
  id: string,
  x: number,
  y: number
): EdgeNodeSet {
  return edgeNodes.map((nodes) =>
    nodes.map((n) => (n.id === id ? { ...n, x, y } : n))
  ) as EdgeNodeSet
}

export function removeEdgeNode(edgeNodes: EdgeNodeSet, id: string): EdgeNodeSet {
  return edgeNodes.map((nodes) => nodes.filter((n) => n.id !== id)) as EdgeNodeSet
}

/** Removes the most recently added node, if any. */
export function removeNewestEdgeNode(edgeNodes: EdgeNodeSet): EdgeNodeSet {
  const all = edgeNodes.flat()
  if (all.length === 0) return edgeNodes
  const newest = all.reduce((a, b) => (b.seq > a.seq ? b : a))
  return removeEdgeNode(edgeNodes, newest.id)
}

/**
 * Writes (segments+1)² vertex positions (x, y, 0 in pixels) for the warp
 * grid into `out`, without allocating. The mesh's UVs are a regular grid,
 * so this decides where each slice of the content lands.
 *
 * Bilinear: a Coons patch over the surface's four edges, each a polyline
 * through its corners and edge nodes:
 *
 *   P(u,v) = (1-v)·top(u) + v·bottom(u) + (1-u)·left(v) + u·right(v)
 *            − bilinear blend of the four corners
 *
 * With no edge nodes every edge is straight and this is exactly the classic
 * bilinear "quad warp". With nodes, the content bends so each edge of the
 * image follows its edge of the shape and the interior blends smoothly
 * between them.
 *
 * Perspective: the same idea with the corners' homography H as the base
 * instead of the bilinear blend. Each edge's offset from H's straight edge
 * is blended inwards:
 *
 *   P(u,v) = H(u,v) + (1-v)·Δtop(u) + v·Δbottom(u) + (1-u)·Δleft(v) + u·Δright(v)
 *
 * With no edge nodes every Δ is zero and this is exactly H -- a true
 * perspective view of a flat surface. Nodes bend it locally, and adding one
 * (on the outline, at the content already there) changes nothing.
 */
export function writeWarpGrid(
  corners: CornerSet,
  edgeNodes: EdgeNodeSet,
  segments: number,
  width: number,
  height: number,
  out: Float32Array,
  warp: WarpMode = 'bilinear'
): void {
  const rows = segments + 1
  const [tl, tr, br, bl] = corners
  const edges = [0, 1, 2, 3].map((e) => edgePoints(corners, edgeNodes, e))
  const { homography: m, weights: w } = warpFrame(corners, warp)

  // Sample each boundary curve once per grid line rather than per vertex.
  // Edge directions: top TL→TR, right TR→BR, bottom BR→BL, left BL→TL --
  // bottom and left run "backwards" relative to u and v, hence 1 - s.
  const top: { x: number; y: number }[] = []
  const bottom: { x: number; y: number }[] = []
  const left: { x: number; y: number }[] = []
  const right: { x: number; y: number }[] = []
  for (let k = 0; k < rows; k++) {
    const s = k / segments
    top.push(evalEdge(edges[0], s, w[0], w[1]))
    right.push(evalEdge(edges[1], s, w[1], w[2]))
    bottom.push(evalEdge(edges[2], 1 - s, w[2], w[3]))
    left.push(evalEdge(edges[3], 1 - s, w[3], w[0]))
  }

  if (m) {
    // Turn the sampled edges into offsets from H's own (straight) edges.
    for (let k = 0; k < rows; k++) {
      const s = k / segments
      subtractInPlace(top[k], applyHomography(m, s, 0))
      subtractInPlace(bottom[k], applyHomography(m, s, 1))
      subtractInPlace(left[k], applyHomography(m, 0, s))
      subtractInPlace(right[k], applyHomography(m, 1, s))
    }
  }

  let i3 = 0
  for (let j = 0; j < rows; j++) {
    const v = j / segments
    for (let i = 0; i < rows; i++) {
      const u = i / segments
      let x: number
      let y: number
      if (m) {
        const base = applyHomography(m, u, v)
        x = base.x + (1 - v) * top[i].x + v * bottom[i].x + (1 - u) * left[j].x + u * right[j].x
        y = base.y + (1 - v) * top[i].y + v * bottom[i].y + (1 - u) * left[j].y + u * right[j].y
      } else {
        x =
          (1 - v) * top[i].x +
          v * bottom[i].x +
          (1 - u) * left[j].x +
          u * right[j].x -
          ((1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + u * v * br.x + (1 - u) * v * bl.x)
        y =
          (1 - v) * top[i].y +
          v * bottom[i].y +
          (1 - u) * left[j].y +
          u * right[j].y -
          ((1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + u * v * br.y + (1 - u) * v * bl.y)
      }
      out[i3++] = x * width
      out[i3++] = y * height
      out[i3++] = 0
    }
  }
}

function subtractInPlace(p: { x: number; y: number }, q: { x: number; y: number }): void {
  p.x -= q.x
  p.y -= q.y
}
