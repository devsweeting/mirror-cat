import { describe, expect, it } from 'vitest'
import {
  MAX_EDGE_NODES,
  addNodeOnLongestSegment,
  boundaryPoints,
  insertEdgeNode,
  moveEdgeNode,
  removeEdgeNode,
  removeNewestEdgeNode,
  writeWarpGrid
} from './surfaceGeometry'
import { DEFAULT_CORNERS, type CornerSet, type EdgeNodeSet } from './types'

const NO_NODES: EdgeNodeSet = [[], [], [], []]
const SKEWED: CornerSet = [
  { x: 0.1, y: 0.2 },
  { x: 0.8, y: 0.05 },
  { x: 0.95, y: 0.9 },
  { x: 0.2, y: 0.75 }
]

function grid(corners: CornerSet, nodes: EdgeNodeSet, segments = 8, w = 1000, h = 500) {
  const out = new Float32Array((segments + 1) ** 2 * 3)
  writeWarpGrid(corners, nodes, segments, w, h, out)
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
