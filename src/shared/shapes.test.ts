import { describe, expect, it } from 'vitest'
import {
  convexHull,
  fitQuad,
  frameToSurface,
  minAreaRect,
  orderCorners,
  polygonArea,
  shapeAt,
  type DetectedShape
} from './shapes'
import type { CornerSet } from './types'

describe('orderCorners', () => {
  it('puts any four corners in surface order: TL, TR, BR, BL', () => {
    const shuffled = [
      { x: 9, y: 8 },
      { x: 1, y: 1 },
      { x: 0, y: 9 },
      { x: 10, y: 0 }
    ]
    expect(orderCorners(shuffled)).toEqual([
      { x: 1, y: 1 },
      { x: 10, y: 0 },
      { x: 9, y: 8 },
      { x: 0, y: 9 }
    ])
  })
})

describe('fitQuad', () => {
  it('gives sharp corners for a rectangle with rounded corners', () => {
    const outline = []
    // 100×60 rectangle, corners rounded with radius 6, traced densely.
    const r = 6
    for (let x = r; x <= 100 - r; x++) outline.push({ x, y: 0 })
    for (let a = -90; a <= 0; a += 10) {
      const t = (a * Math.PI) / 180
      outline.push({ x: 100 - r + r * Math.cos(t), y: r + r * Math.sin(t) })
    }
    for (let y = r; y <= 60 - r; y++) outline.push({ x: 100, y })
    for (let x = 100 - r; x >= r; x--) outline.push({ x, y: 60 })
    for (let y = 60 - r; y >= r; y--) outline.push({ x: 0, y })
    const quad = fitQuad(convexHull(outline), outline)!
    const corners = orderCorners(quad)
    const expected = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 }
    ]
    corners.forEach((c, i) => {
      expect(c.x).toBeCloseTo(expected[i].x, 0)
      expect(c.y).toBeCloseTo(expected[i].y, 0)
    })
  })

  it('refuses shapes that aren’t four-sided', () => {
    const circle = Array.from({ length: 64 }, (_, i) => ({
      x: 50 + 40 * Math.cos((i / 64) * Math.PI * 2),
      y: 50 + 40 * Math.sin((i / 64) * Math.PI * 2)
    }))
    const quad = fitQuad(circle)
    // Either no fit, or one that covers far less than the circle.
    if (quad) expect(polygonArea(quad)).toBeLessThan(polygonArea(circle) * 0.92)
  })
})

describe('minAreaRect', () => {
  it('finds the tilted rectangle around a tilted square', () => {
    const square = [
      { x: 0, y: 5 },
      { x: 5, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 10 }
    ]
    expect(polygonArea(minAreaRect(square))).toBeCloseTo(50, 5)
  })
})

describe('frameToSurface', () => {
  it('maps frame points into the surface’s own 0..1 space', () => {
    const corners: CornerSet = [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.8 },
      { x: 0.2, y: 0.8 }
    ]
    const [a, b] = frameToSurface(
      [
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.5 }
      ],
      corners
    )!
    expect(a.u).toBeCloseTo(0)
    expect(a.v).toBeCloseTo(0)
    expect(b.u).toBeCloseTo(0.5)
    expect(b.v).toBeCloseTo(0.5)
  })
})

describe('shapeAt', () => {
  it('picks the smallest shape under the point, so inner shapes stay clickable', () => {
    const square = (x0: number, x1: number, area: number, id: string): DetectedShape => {
      const corners: CornerSet = [
        { x: x0, y: x0 },
        { x: x1, y: x0 },
        { x: x1, y: x1 },
        { x: x0, y: x1 }
      ]
      return { id, kind: 'quad', corners, outline: corners, area }
    }
    const shapes = [square(0.1, 0.9, 0.64, 'outer'), square(0.4, 0.6, 0.04, 'inner')]
    expect(shapeAt(shapes, { x: 0.5, y: 0.5 })?.id).toBe('inner')
    expect(shapeAt(shapes, { x: 0.2, y: 0.2 })?.id).toBe('outer')
    expect(shapeAt(shapes, { x: 0.95, y: 0.5 })).toBeNull()
  })
})
