import type { CornerSet, EdgeNode, EdgeNodeSet } from './types'

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

/** Point on a piecewise-linear edge at content parameter s (0..1). */
export function evalEdge(points: EdgePoint[], s: number): { x: number; y: number } {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (s <= b.t || i === points.length - 2) {
      const span = b.t - a.t
      const k = span > 0 ? (s - a.t) / span : 0
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
  }
  return { x: points[0].x, y: points[0].y }
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
 * sits exactly on the existing straight segment, adding it never changes the
 * shape or the warp -- it just gives you a new point to drag.
 *
 * `aspect` (frame width / height) weights horizontal length so "longest"
 * matches what you see; 1 is fine when the frame shape isn't known.
 */
export function addNodeOnLongestSegment(
  corners: CornerSet,
  edgeNodes: EdgeNodeSet,
  aspect = 1
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
  return insertEdgeNode(edgeNodes, edge, (a.t + b.t) / 2, (a.x + b.x) / 2, (a.y + b.y) / 2)
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
 * grid into `out`, without
 * allocating. The grid is a Coons patch over the surface's four edges, each
 * a polyline through its corners and edge nodes:
 *
 *   P(u,v) = (1-v)·top(u) + v·bottom(u) + (1-u)·left(v) + u·right(v)
 *            − bilinear blend of the four corners
 *
 * With no edge nodes every edge is straight and this is exactly the classic
 * bilinear "quad warp". With nodes, the content bends so each edge of the
 * image follows its edge of the shape and the interior blends smoothly
 * between them.
 */
export function writeWarpGrid(
  corners: CornerSet,
  edgeNodes: EdgeNodeSet,
  segments: number,
  width: number,
  height: number,
  out: Float32Array
): void {
  const rows = segments + 1
  const [tl, tr, br, bl] = corners
  const edges = [0, 1, 2, 3].map((e) => edgePoints(corners, edgeNodes, e))

  // Sample each boundary curve once per grid line rather than per vertex.
  // Edge directions: top TL→TR, right TR→BR, bottom BR→BL, left BL→TL --
  // bottom and left run "backwards" relative to u and v, hence 1 - s.
  const top: { x: number; y: number }[] = []
  const bottom: { x: number; y: number }[] = []
  const left: { x: number; y: number }[] = []
  const right: { x: number; y: number }[] = []
  for (let k = 0; k < rows; k++) {
    const s = k / segments
    top.push(evalEdge(edges[0], s))
    right.push(evalEdge(edges[1], s))
    bottom.push(evalEdge(edges[2], 1 - s))
    left.push(evalEdge(edges[3], 1 - s))
  }

  let i3 = 0
  for (let j = 0; j < rows; j++) {
    const v = j / segments
    for (let i = 0; i < rows; i++) {
      const u = i / segments
      const x =
        (1 - v) * top[i].x +
        v * bottom[i].x +
        (1 - u) * left[j].x +
        u * right[j].x -
        ((1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + u * v * br.x + (1 - u) * v * bl.x)
      const y =
        (1 - v) * top[i].y +
        v * bottom[i].y +
        (1 - u) * left[j].y +
        u * right[j].y -
        ((1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + u * v * br.y + (1 - u) * v * bl.y)
      out[i3++] = x * width
      out[i3++] = y * height
      out[i3++] = 0
    }
  }
}
