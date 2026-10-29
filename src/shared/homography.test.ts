import { describe, expect, it } from 'vitest'
import { applyHomography, squareToQuad } from './surfaceGeometry'
import { fitHomography, invertHomography } from './homography'
import { photoSurfaceCorners } from './scanPattern'
import type { CornerSet } from './types'

const QUAD: CornerSet = [
  { x: 0.1, y: 0.15 },
  { x: 0.8, y: 0.2 },
  { x: 0.75, y: 0.85 },
  { x: 0.12, y: 0.8 }
]

describe('fitHomography', () => {
  it('recovers a known homography from four exact pairs', () => {
    const truth = squareToQuad(QUAD)!
    const unit = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ]
    const fitted = fitHomography(
      unit.map(([u, v]) => ({ from: { x: u, y: v }, to: applyHomography(truth, u, v) }))
    )!
    for (const [u, v] of [
      [0.5, 0.5],
      [0.2, 0.9],
      [0.95, 0.05]
    ]) {
      const a = applyHomography(truth, u, v)
      const b = applyHomography(fitted, u, v)
      expect(b.x).toBeCloseTo(a.x, 9)
      expect(b.y).toBeCloseTo(a.y, 9)
    }
  })

  it('averages noisy pairs (pixels in, pixels out)', () => {
    const truth = { a: 1.1, b: 0.05, c: 120, d: -0.03, e: 0.95, f: 80, g: 0.0002, h: -0.0001 }
    let seed = 3
    const jitter = (): number => {
      seed = (seed * 16807) % 2147483647
      return (seed / 2147483647 - 0.5) * 1.5
    }
    const pairs = []
    for (let i = 0; i < 16; i++) {
      const from = { x: (i % 4) * 400 + 50, y: Math.floor(i / 4) * 250 + 40 }
      const to = applyHomography(truth, from.x, from.y)
      pairs.push({ from, to: { x: to.x + jitter(), y: to.y + jitter() } })
    }
    const fitted = fitHomography(pairs)!
    const probe = applyHomography(fitted, 800, 500)
    const expected = applyHomography(truth, 800, 500)
    expect(Math.hypot(probe.x - expected.x, probe.y - expected.y)).toBeLessThan(1)
  })

  it('refuses fewer than four pairs or collinear points', () => {
    expect(fitHomography([])).toBeNull()
    const line = [0, 1, 2, 3].map((i) => ({ from: { x: i, y: i }, to: { x: i * 2, y: i * 2 } }))
    expect(fitHomography(line)).toBeNull()
  })
})

describe('invertHomography', () => {
  it('round-trips points', () => {
    const m = squareToQuad(QUAD)!
    const inv = invertHomography(m)!
    const p = applyHomography(m, 0.3, 0.7)
    const back = applyHomography(inv, p.x, p.y)
    expect(back.x).toBeCloseTo(0.3, 9)
    expect(back.y).toBeCloseTo(0.7, 9)
  })
})

describe('photoSurfaceCorners', () => {
  it('is the identity when the photo is exactly the frame', () => {
    const corners = photoSurfaceCorners([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ])!
    expect(corners.map((c) => [c.x, c.y].map((v) => +v.toFixed(9)))).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ])
  })

  it('spreads the photo past the frame when the frame fills only part of it', () => {
    // Frame occupies the middle 80% of the photo: the photo's edges sit 12.5% outside the frame.
    const corners = photoSurfaceCorners([
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 }
    ])!
    expect(corners[0].x).toBeCloseTo(-0.125, 9)
    expect(corners[0].y).toBeCloseTo(-0.125, 9)
    expect(corners[2].x).toBeCloseTo(1.125, 9)
    expect(corners[2].y).toBeCloseTo(1.125, 9)
  })

  it('maps each photo point to the frame point that lit it', () => {
    const frameInPhoto = QUAD
    const surface = photoSurfaceCorners(frameInPhoto)!
    // The surface shows the photo via unit square → surface corners. A
    // photo point p should land where the frame→photo map says it came from.
    const surfaceMap = squareToQuad(surface)!
    const frameToPhoto = squareToQuad(frameInPhoto)!
    const framePoint = { x: 0.4, y: 0.6 }
    const photoPoint = applyHomography(frameToPhoto, framePoint.x, framePoint.y)
    const landed = applyHomography(surfaceMap, photoPoint.x, photoPoint.y)
    expect(landed.x).toBeCloseTo(framePoint.x, 9)
    expect(landed.y).toBeCloseTo(framePoint.y, 9)
  })
})
