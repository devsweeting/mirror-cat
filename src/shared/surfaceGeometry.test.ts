import { describe, expect, it } from 'vitest'
import {
  MAX_EDGE_NODES,
  addNodeOnLongestSegment,
  boundaryPoints,
  insertEdgeNode,
  moveEdgeNode,
  removeEdgeNode,
  removeNewestEdgeNode,
  segmentContentParam,
  isConvexQuad,
  squareToQuad,
  applyHomography,
  warpFrame,
  writeWarpGrid
} from './surfaceGeometry'
import { DEFAULT_CORNERS, type CornerSet, type EdgeNodeSet, type WarpMode } from './types'

const NO_NODES: EdgeNodeSet = [[], [], [], []]
const SKEWED: CornerSet = [
  { x: 0.1, y: 0.2 },
  { x: 0.8, y: 0.05 },
  { x: 0.95, y: 0.9 },
  { x: 0.2, y: 0.75 }
]

function grid(
  corners: CornerSet,
  nodes: EdgeNodeSet,
  segments = 8,
  w = 1000,
  h = 500,
  warp: WarpMode = 'bilinear'
) {
  const out = new Float32Array((segments + 1) ** 2 * 3)
  writeWarpGrid(corners, nodes, segments, w, h, out, warp)
  const at = (i: number, j: number) => {
    const k = (j * (segments + 1) + i) * 3
    return { x: out[k], y: out[k + 1], z: out[k + 2] }
  }
  return { out, at }
}

function bilinear(c: CornerSet, u: number, v: number) {
  const [tl, tr, br, bl] = c
  return {
    x: (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + u * v * br.x + (1 - u) * v * bl.x,
    y: (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + u * v * br.y + (1 - u) * v * bl.y
  }
}

describe('writeWarpGrid', () => {
  it('is the plain bilinear quad warp when there are no edge nodes', () => {
    const segments = 8
    const { at } = grid(SKEWED, NO_NODES, segments, 1000, 500)
    for (const [i, j] of [
      [0, 0],
      [3, 5],
      [8, 2],
      [8, 8],
      [4, 4]
    ]) {
      const expected = bilinear(SKEWED, i / segments, j / segments)
      const p = at(i, j)
      expect(p.x).toBeCloseTo(expected.x * 1000, 2)
      expect(p.y).toBeCloseTo(expected.y * 500, 2)
      expect(p.z).toBe(0)
    }
  })

  it('pins the grid corners to the surface corners, even with bent edges', () => {
    let nodes = insertEdgeNode(NO_NODES, 0, 0.5, 0.5, 0.0)
    nodes = insertEdgeNode(nodes, 2, 0.3, 0.6, 0.98)
    const segments = 10
    const { at } = grid(SKEWED, nodes, segments)
    const corners = [at(0, 0), at(segments, 0), at(segments, segments), at(0, segments)]
    corners.forEach((p, k) => {
      expect(p.x).toBeCloseTo(SKEWED[k].x * 1000, 2)
      expect(p.y).toBeCloseTo(SKEWED[k].y * 500, 2)
    })
  })

  it('makes the top row pass through a node on the top edge', () => {
    const nodes = insertEdgeNode(NO_NODES, 0, 0.5, 0.5, 0.02)
    const segments = 10
    const { at } = grid(DEFAULT_CORNERS, nodes, segments)
    const mid = at(5, 0)
    expect(mid.x).toBeCloseTo(500, 2)
    expect(mid.y).toBeCloseTo(0.02 * 500, 2)
  })

  it('never produces NaN for a collapsed surface', () => {
    const point: CornerSet = [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 }
    ]
    const { out } = grid(point, NO_NODES)
    expect(out.every(Number.isFinite)).toBe(true)
  })
})

describe('edge nodes', () => {
  it('inserts nodes sorted by t with increasing seq, without mutating the input', () => {
    const a = insertEdgeNode(NO_NODES, 1, 0.7, 0.85, 0.6)
    const b = insertEdgeNode(a, 1, 0.3, 0.85, 0.3)
    expect(NO_NODES[1]).toHaveLength(0)
    expect(a[1]).toHaveLength(1)
    expect(b[1].map((n) => n.t)).toEqual([0.3, 0.7])
    expect(b[1].map((n) => n.seq)).toEqual([2, 1])
    expect(new Set(b.flat().map((n) => n.id)).size).toBe(2)
  })

  it('refuses nodes on top of a corner or another node', () => {
    const a = insertEdgeNode(NO_NODES, 0, 0.5, 0.5, 0.15)
    expect(insertEdgeNode(a, 0, 0.505, 0.5, 0.15)).toBe(a)
    expect(insertEdgeNode(a, 0, 0.001, 0.15, 0.15)).toBe(a)
    expect(insertEdgeNode(a, 0, 0.999, 0.85, 0.15)).toBe(a)
  })

  it('stops at MAX_EDGE_NODES', () => {
    let nodes: EdgeNodeSet = NO_NODES
    for (let k = 0; k < MAX_EDGE_NODES + 5; k++) {
      nodes = insertEdgeNode(nodes, k % 4, 0.05 + 0.03 * Math.floor(k / 4), 0.5, 0.5)
    }
    expect(nodes.flat()).toHaveLength(MAX_EDGE_NODES)
  })

  it('moves, removes and removes-newest by id', () => {
    let nodes = insertEdgeNode(NO_NODES, 0, 0.25, 0.3, 0.15)
    nodes = insertEdgeNode(nodes, 2, 0.5, 0.5, 0.85)
    const [first] = nodes[0]
    const moved = moveEdgeNode(nodes, first.id, 0.31, 0.1)
    expect(moved[0][0]).toMatchObject({ id: first.id, x: 0.31, y: 0.1, t: 0.25 })
    expect(removeEdgeNode(moved, first.id).flat()).toHaveLength(1)
    const newestGone = removeNewestEdgeNode(nodes)
    expect(newestGone[2]).toHaveLength(0)
    expect(newestGone[0]).toHaveLength(1)
    expect(removeNewestEdgeNode(NO_NODES)).toBe(NO_NODES)
  })

  it('adds a node on the longest segment without changing the warp', () => {
    const before = grid(SKEWED, NO_NODES).out
    const nodes = addNodeOnLongestSegment(SKEWED, NO_NODES)
    expect(nodes.flat()).toHaveLength(1)
    const after = grid(SKEWED, nodes).out
    after.forEach((value, k) => expect(value).toBeCloseTo(before[k], 2))
  })

  it('lists every corner and node once around the outline', () => {
    let nodes = insertEdgeNode(NO_NODES, 0, 0.5, 0.5, 0.15)
    nodes = insertEdgeNode(nodes, 3, 0.5, 0.15, 0.5)
    const outline = boundaryPoints(DEFAULT_CORNERS, nodes)
    expect(outline).toHaveLength(6)
    expect(outline.map((p) => p.edge)).toEqual([0, 0, 1, 2, 3, 3])
  })
})

// A wall seen from below-left: the top edge is further away, so shorter.
const TRAPEZOID: CornerSet = [
  { x: 0.3, y: 0.1 },
  { x: 0.7, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 }
]

function intersectDiagonals(c: CornerSet) {
  const [p0, p1, p2, p3] = c
  // p0 + s(p2 - p0) = p1 + r(p3 - p1)
  const d1x = p2.x - p0.x
  const d1y = p2.y - p0.y
  const d2x = p3.x - p1.x
  const d2y = p3.y - p1.y
  const s = ((p1.x - p0.x) * d2y - (p1.y - p0.y) * d2x) / (d1x * d2y - d1y * d2x)
  return { x: p0.x + s * d1x, y: p0.y + s * d1y }
}

describe('perspective warp', () => {
  it('maps the unit square exactly onto the corners', () => {
    const m = squareToQuad(SKEWED)!
    expect(m).not.toBeNull()
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ]
    uv.forEach(([u, v], i) => {
      const p = applyHomography(m, u, v)
      expect(p.x).toBeCloseTo(SKEWED[i].x, 9)
      expect(p.y).toBeCloseTo(SKEWED[i].y, 9)
    })
  })

  it('puts the content center where the diagonals cross, not at the shape midpoint', () => {
    const { at } = grid(TRAPEZOID, NO_NODES, 8, 1, 1, 'perspective')
    const center = at(4, 4)
    const cross = intersectDiagonals(TRAPEZOID)
    expect(center.x).toBeCloseTo(cross.x, 4)
    expect(center.y).toBeCloseTo(cross.y, 4)
    // The far (top) half is foreshortened: the center sits above y = 0.5.
    expect(center.y).toBeLessThan(0.45)
    // Bilinear puts it at the midpoint.
    expect(grid(TRAPEZOID, NO_NODES, 8, 1, 1).at(4, 4).y).toBeCloseTo(0.5, 6)
  })

  it('keeps straight content lines straight (including diagonals)', () => {
    const segments = 8
    const { at } = grid(SKEWED, NO_NODES, segments, 1000, 500, 'perspective')
    const collinear = (pts: { x: number; y: number }[]) => {
      const [a, b] = [pts[0], pts[pts.length - 1]]
      for (const p of pts) {
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
        expect(Math.abs(cross) / Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1e-2)
      }
    }
    const k = [...Array(segments + 1).keys()]
    collinear(k.map((i) => at(i, 3)))
    collinear(k.map((j) => at(5, j)))
    collinear(k.map((i) => at(i, i)))
  })

  it('matches bilinear for a parallelogram (nothing to foreshorten)', () => {
    const para: CornerSet = [
      { x: 0.1, y: 0.2 },
      { x: 0.6, y: 0.1 },
      { x: 0.8, y: 0.7 },
      { x: 0.3, y: 0.8 }
    ]
    const p = grid(para, NO_NODES, 6, 1000, 500, 'perspective').out
    const b = grid(para, NO_NODES, 6, 1000, 500).out
    p.forEach((v, i) => expect(v).toBeCloseTo(b[i], 2))
  })

  it('falls back to bilinear when the corners are not convex', () => {
    const dart: CornerSet = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.35, y: 0.35 },
      { x: 0.1, y: 0.9 }
    ]
    const bowTie: CornerSet = [TRAPEZOID[0], TRAPEZOID[1], TRAPEZOID[3], TRAPEZOID[2]]
    for (const c of [dart, bowTie]) {
      expect(isConvexQuad(c)).toBe(false)
      expect(warpFrame(c, 'perspective').homography).toBeNull()
      const p = grid(c, NO_NODES, 4, 1000, 500, 'perspective').out
      const b = grid(c, NO_NODES, 4, 1000, 500).out
      expect(Array.from(p)).toEqual(Array.from(b))
    }
    expect(isConvexQuad(DEFAULT_CORNERS)).toBe(true)
  })

  it('bends edges through their nodes', () => {
    const segments = 8
    const nodes = insertEdgeNode(NO_NODES, 0, 0.5, 0.52, 0.02)
    const { at } = grid(TRAPEZOID, nodes, segments, 1, 1, 'perspective')
    expect(at(4, 0).x).toBeCloseTo(0.52, 5)
    expect(at(4, 0).y).toBeCloseTo(0.02, 5)
    // Corners stay pinned.
    expect(at(0, 0).x).toBeCloseTo(TRAPEZOID[0].x, 6)
    expect(at(8, 8).y).toBeCloseTo(TRAPEZOID[2].y, 6)
  })

  it('adding a node on the outline never moves the content', () => {
    for (const warp of ['perspective', 'bilinear'] as const) {
      const before = grid(TRAPEZOID, NO_NODES, 16, 1000, 500, warp).out
      const added = addNodeOnLongestSegment(TRAPEZOID, NO_NODES, 1, warp)
      expect(added.flat()).toHaveLength(1)
      const after = grid(TRAPEZOID, added, 16, 1000, 500, warp).out
      after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 2))

      // Same for a double-click a third of the way along the left edge.
      const [bl, tl] = [TRAPEZOID[3], TRAPEZOID[0]]
      const k = 1 / 3
      const t = segmentContentParam(TRAPEZOID, warp, 3, 0, 1, k)
      const clicked = insertEdgeNode(
        NO_NODES,
        3,
        t,
        bl.x + (tl.x - bl.x) * k,
        bl.y + (tl.y - bl.y) * k
      )
      const after2 = grid(TRAPEZOID, clicked, 16, 1000, 500, warp).out
      after2.forEach((v, i) => expect(v).toBeCloseTo(before[i], 2))
    }
  })
})
