import { describe, expect, it } from 'vitest'
import {
  applyEdgeNodeFrames,
  aspectLabel,
  captureEdgeNodeFrames,
  cornersAspect,
  proportionalCorners
} from './proportionalResize'
import { insertEdgeNode } from './surfaceGeometry'
import { DEFAULT_CORNERS, type CornerSet, type EdgeNodeSet } from './types'

const W = 1920
const H = 1080

function pixelAspect(c: CornerSet): number {
  return ((c[1].x - c[0].x) * W) / ((c[3].y - c[0].y) * H)
}

describe('proportionalCorners', () => {
  it('produces an upright rectangle in the requested aspect, in pixels', () => {
    const corners = proportionalCorners(2, { x: 0.1, y: 0.1 }, { x: 0.6, y: 0.4 }, 16 / 9, W, H)
    expect(pixelAspect(corners)).toBeCloseTo(16 / 9, 5)
    expect(corners[0].y).toBeCloseTo(corners[1].y)
    expect(corners[0].x).toBeCloseTo(corners[3].x)
  })

  it('keeps the opposite corner fixed for every dragged corner', () => {
    const anchors = [
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 }
    ]
    anchors.forEach((anchor, index) => {
      const corners = proportionalCorners(index, anchor, { x: 0.5, y: 0.5 }, 1, W, H)
      const fixed = corners[(index + 2) % 4]
      expect(fixed.x).toBeCloseTo(anchor.x)
      expect(fixed.y).toBeCloseTo(anchor.y)
    })
  })

  it('never mirrors: dragging past the anchor bottoms out at a minimum size', () => {
    // Dragging the bottom-right corner up-left past its top-left anchor.
    const corners = proportionalCorners(2, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.1 }, 1, W, H)
    const [tl, , br] = corners
    expect(tl).toEqual({ x: 0.5, y: 0.5 })
    expect(br.x).toBeGreaterThan(tl.x)
    expect(br.y).toBeGreaterThan(tl.y)
    expect((br.x - tl.x) * W).toBeCloseTo(16, 5)
  })

  it('stays inside the frame', () => {
    const corners = proportionalCorners(2, { x: 0.5, y: 0.5 }, { x: 5, y: 5 }, 4 / 3, W, H)
    for (const c of corners) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x).toBeLessThanOrEqual(1)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeLessThanOrEqual(1)
    }
    expect(pixelAspect(corners)).toBeCloseTo(4 / 3, 5)
  })
})

describe('cornersAspect', () => {
  it('measures in pixels, not normalized units', () => {
    expect(cornersAspect(DEFAULT_CORNERS, W, H)).toBeCloseTo(16 / 9)
    expect(cornersAspect(DEFAULT_CORNERS, 1000, 1000)).toBeCloseTo(1)
  })

  it('falls back to 1 for a collapsed shape', () => {
    const p = { x: 0.5, y: 0.5 }
    expect(cornersAspect([p, p, p, p], W, H)).toBe(1)
  })
})

describe('edge node frames', () => {
  const nodes: EdgeNodeSet = insertEdgeNode([[], [], [], []], 0, 0.5, 0.5, 0.1)

  it('round-trips: re-applying to the same corners leaves nodes in place', () => {
    const frames = captureEdgeNodeFrames(DEFAULT_CORNERS, nodes, W, H)
    const again = applyEdgeNodeFrames(nodes, frames, DEFAULT_CORNERS, W, H)
    expect(again[0][0].x).toBeCloseTo(0.5)
    expect(again[0][0].y).toBeCloseTo(0.1)
  })

  it('scales a bend with the surface', () => {
    const frames = captureEdgeNodeFrames(DEFAULT_CORNERS, nodes, W, H)
    // Same top-left corner, half the size.
    const half: CornerSet = [
      { x: 0.15, y: 0.15 },
      { x: 0.5, y: 0.15 },
      { x: 0.5, y: 0.5 },
      { x: 0.15, y: 0.5 }
    ]
    const scaled = applyEdgeNodeFrames(nodes, frames, half, W, H)
    expect(scaled[0][0].x).toBeCloseTo(0.325)
    // Originally 0.05 above the edge; now 0.025 above.
    expect(scaled[0][0].y).toBeCloseTo(0.125)
    expect(scaled[0][0].t).toBe(0.5)
  })
})

describe('aspectLabel', () => {
  it.each([
    [16 / 9, '16:9'],
    [1920 / 1080, '16:9'],
    [4 / 3, '4:3'],
    [1, '1:1'],
    [16 / 10, '8:5'],
    [2.39, '2.39:1']
  ])('%f → %s', (aspect, label) => {
    expect(aspectLabel(aspect)).toBe(label)
  })
})
