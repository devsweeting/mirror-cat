import { describe, expect, it } from 'vitest'
import type { CornerSet, EdgeNodeSet, WarpMode } from './types'
import { applyHomography, squareToQuad, writeWarpGrid } from './surfaceGeometry'
import { WARP_SEGMENTS, pickWarpGrid } from './warpPick'

const NO_NODES: EdgeNodeSet = [[], [], [], []]
const W = 800
const H = 600

function grid(corners: CornerSet, warp: WarpMode, nodes: EdgeNodeSet = NO_NODES): Float32Array {
  const rows = WARP_SEGMENTS + 1
  const out = new Float32Array(rows * rows * 3)
  writeWarpGrid(corners, nodes, WARP_SEGMENTS, W, H, out, warp)
  return out
}

const RECT: CornerSet = [
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.25 },
  { x: 0.75, y: 0.75 },
  { x: 0.25, y: 0.75 }
]

// A wall seen at an angle: right side shorter.
const ANGLED: CornerSet = [
  { x: 0.1, y: 0.1 },
  { x: 0.7, y: 0.25 },
  { x: 0.7, y: 0.75 },
  { x: 0.1, y: 0.9 }
]

describe('pickWarpGrid', () => {
  it('inverts an upright rectangle exactly', () => {
    const pick = pickWarpGrid(grid(RECT, 'bilinear'), WARP_SEGMENTS, 0.5 * W, 0.5 * H)!
    expect(pick.inside).toBe(true)
    expect(pick.u).toBeCloseTo(0.5, 6)
    expect(pick.v).toBeCloseTo(0.5, 6)
    // 1 unit of u spans the rectangle's width on screen.
    expect(pick.du.x).toBeCloseTo(0.5 * W, 3)
    expect(pick.du.y).toBeCloseTo(0, 3)
    expect(pick.dv.y).toBeCloseTo(0.5 * H, 3)
  })

  it('round-trips points through a perspective warp', () => {
    const m = squareToQuad(ANGLED)!
    for (const [u, v] of [
      [0.1, 0.1],
      [0.5, 0.5],
      [0.83, 0.27],
      [0.95, 0.9]
    ]) {
      const p = applyHomography(m, u, v)
      const pick = pickWarpGrid(grid(ANGLED, 'perspective'), WARP_SEGMENTS, p.x * W, p.y * H)!
      expect(pick.inside).toBe(true)
      // Within the mesh's own linear approximation of the homography.
      expect(pick.u).toBeCloseTo(u, 3)
      expect(pick.v).toBeCloseTo(v, 3)
    }
  })

  it('follows edge nodes (inverts the drawn mesh, not just the corners)', () => {
    const bulge: EdgeNodeSet = [[{ id: 'n', seq: 1, t: 0.5, x: 0.5, y: 0.1 }], [], [], []]
    const g = grid(RECT, 'bilinear', bulge)
    // The top edge's midpoint was pulled up to y = 0.1: that's content (0.5, 0).
    const pick = pickWarpGrid(g, WARP_SEGMENTS, 0.5 * W, 0.1 * H + 0.5)!
    expect(pick.inside).toBe(true)
    expect(pick.u).toBeCloseTo(0.5, 2)
    expect(pick.v).toBeCloseTo(0, 2)
  })

  it('extrapolates points just off the surface from the nearest triangle', () => {
    const pick = pickWarpGrid(grid(RECT, 'bilinear'), WARP_SEGMENTS, 0.2 * W, 0.5 * H)!
    expect(pick.inside).toBe(false)
    expect(pick.u).toBeCloseTo(-0.1, 3)
    expect(pick.v).toBeCloseTo(0.5, 3)
  })

  it('returns null for a collapsed surface', () => {
    const point: CornerSet = [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 }
    ]
    expect(pickWarpGrid(grid(point, 'bilinear'), WARP_SEGMENTS, 400, 300)).toBeNull()
  })
})
