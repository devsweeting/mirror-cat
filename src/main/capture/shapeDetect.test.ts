import { describe, expect, it } from 'vitest'
import { addCandidates, bestInBox, candidateFromMask, combineShapes, findShapes, regionMask, shapeDetectSize } from './shapeDetect'
import { markerPlacements } from '../../shared/scanPattern'
import { pointInPolygon, type DetectedShape } from '../../shared/shapes'
import type { Point } from '../../shared/homography'

const W = 640
const H = 360

/** A plain wall lit by the scan pattern, with things painted on it. */
function wall(level = 150): Uint8Array {
  const rgba = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    // A little noise, like a real photo.
    const v = level + ((i * 2654435761) % 7) - 3
    rgba.set([v, v, v, 255], i * 4)
  }
  return rgba
}

function paint(rgba: Uint8Array, inside: (x: number, y: number) => boolean, level: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (inside(x + 0.5, y + 0.5)) rgba.set([level, level, level, 255], (y * W + x) * 4)
    }
  }
}

const px = (p: Point): Point => ({ x: p.x * W, y: p.y * H })

function nearest(shapes: DetectedShape[], x: number, y: number): DetectedShape | undefined {
  return shapes.find((s) => pointInPolygon({ x: x / W, y: y / H }, s.outline))
}

describe('findShapes', () => {
  it('finds a dark frame on the wall as a four-sided shape with its corners', () => {
    const rgba = wall()
    paint(rgba, (x, y) => x >= 200 && x < 360 && y >= 100 && y < 240, 40)
    const { shapes } = findShapes(rgba, W, H)
    const frame = nearest(shapes, 280, 170)
    expect(frame?.kind).toBe('quad')
    const corners = frame!.corners.map(px)
    const expected = [
      { x: 200, y: 100 },
      { x: 360, y: 100 },
      { x: 360, y: 240 },
      { x: 200, y: 240 }
    ]
    corners.forEach((c, i) => {
      expect(Math.abs(c.x - expected[i].x)).toBeLessThan(3)
      expect(Math.abs(c.y - expected[i].y)).toBeLessThan(3)
    })
  })

  it('finds a box face seen at an angle, even at nearly the wall’s brightness', () => {
    const rgba = wall()
    const face = [
      { x: 120, y: 90 },
      { x: 300, y: 120 },
      { x: 290, y: 280 },
      { x: 110, y: 300 }
    ]
    paint(rgba, (x, y) => pointInPolygon({ x, y }, face), 185)
    const shape = nearest(findShapes(rgba, W, H).shapes, 200, 200)
    expect(shape?.kind).toBe('quad')
    shape!.corners.map(px).forEach((c, i) => {
      expect(Math.hypot(c.x - face[i].x, c.y - face[i].y)).toBeLessThan(4)
    })
  })

  it('outlines a round shape and fits a rectangle around it', () => {
    const rgba = wall()
    paint(rgba, (x, y) => Math.hypot(x - 450, y - 180) < 70, 60)
    const shape = nearest(findShapes(rgba, W, H).shapes, 450, 180)
    expect(shape?.kind).toBe('outline')
    const corners = shape!.corners.map(px)
    const xs = corners.map((c) => c.x)
    const ys = corners.map((c) => c.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(130)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(130)
    expect(shape!.area).toBeGreaterThan(0.06)
  })

  it('treats a picture inside a frame as one shape plus the picture', () => {
    const rgba = wall()
    paint(rgba, (x, y) => x >= 100 && x < 400 && y >= 60 && y < 300, 30)
    paint(rgba, (x, y) => x >= 130 && x < 370 && y >= 90 && y < 270, 220)
    const { shapes } = findShapes(rgba, W, H)
    const outer = shapes.filter((s) => s.kind === 'quad' && s.area > 0.25)
    const inner = shapes.filter((s) => s.kind === 'quad' && s.area > 0.15 && s.area < 0.25)
    expect(outer).toHaveLength(1)
    expect(inner).toHaveLength(1)
  })

  it('finds a frame cut off by the bottom of the photo, not just the picture inside', () => {
    // Devin's scan: a dark frame running off the bottom, green art inside.
    const rgba = wall()
    paint(rgba, (x, y) => x >= 200 && x < 560 && y >= 110, 35)
    paint(rgba, (x, y) => x >= 216 && x < 544 && y >= 126, 60)
    const { shapes } = findShapes(rgba, W, H)
    const frame = shapes.find((s) => s.kind === 'quad' && s.corners[0].x * W < 205)
    expect(frame).toBeDefined()
    const corners = frame!.corners.map(px)
    expect(Math.abs(corners[0].x - 200)).toBeLessThan(3)
    expect(Math.abs(corners[0].y - 110)).toBeLessThan(3)
    expect(corners[2].y).toBeGreaterThan(H - 3)
    // The picture inside is offered too.
    expect(shapes.some((s) => s.kind === 'quad' && Math.abs(s.corners[0].x * W - 216) < 3)).toBe(true)
  })

  it('ignores the wall, the scan pattern’s markers and specks', () => {
    const rgba = wall()
    for (const m of markerPlacements(W, H)) {
      paint(rgba, (x, y) => x >= m.x && x < m.x + m.size && y >= m.y && y < m.y + m.size, 0)
      paint(rgba, (x, y) => x >= m.x + 10 && x < m.x + 20 && y >= m.y + 10 && y < m.y + 20, 255)
    }
    paint(rgba, (x, y) => Math.hypot(x - 320, y - 180) < 3, 0)
    expect(findShapes(rgba, W, H).shapes).toEqual([])
  })

  it('numbers shapes in reading order', () => {
    const rgba = wall()
    paint(rgba, (x, y) => x >= 380 && x < 500 && y >= 80 && y < 160, 40)
    paint(rgba, (x, y) => x >= 140 && x < 260 && y >= 80 && y < 160, 40)
    paint(rgba, (x, y) => x >= 260 && x < 380 && y >= 220 && y < 300, 40)
    const { shapes } = findShapes(rgba, W, H)
    expect(shapes.map((s) => s.id)).toEqual(['shape-1', 'shape-2', 'shape-3'])
    expect(shapes[0].corners[0].x).toBeLessThan(shapes[1].corners[0].x)
    expect(shapes[2].corners[0].y).toBeGreaterThan(shapes[0].corners[0].y)
  })
})

describe('candidates from masks and boxes', () => {
  /** A whole-picture mask (like a SAM answer) with a speck off to the side. */
  function circleMask(cx: number, cy: number, r: number): Uint8Array {
    const m = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - cx, y - cy) < r) m[y * W + x] = 1
    m[5 * W + 300] = 1
    return m
  }

  it('turns a mask into a traced shape, ignoring stray specks', () => {
    const c = candidateFromMask(circleMask(450, 180, 60), W, H)!
    expect(c.shape.kind).toBe('outline')
    expect(c.shape.area).toBeCloseTo((Math.PI * 60 * 60) / (W * H), 2)
  })

  it('adds new shapes after the ones found, and recognises one already there', () => {
    const rgba = wall()
    paint(rgba, (x, y) => x >= 100 && x < 220 && y >= 100 && y < 220, 40)
    const scan = findShapes(rgba, W, H)
    expect(scan.shapes.map((s) => s.id)).toEqual(['shape-1'])
    const round = candidateFromMask(circleMask(450, 180, 60), W, H)!
    const square = new Uint8Array(W * H)
    for (let y = 100; y < 220; y++) for (let x = 100; x < 220; x++) square[y * W + x] = 1
    const { added, existing } = addCandidates(scan, [round, candidateFromMask(square, W, H)!])
    expect(added.map((s) => s.id)).toEqual(['shape-2'])
    expect(existing.map((s) => s.id)).toEqual(['shape-1'])
    expect(scan.regions.has('shape-2')).toBe(true)
  })

  it('a box picks the frame around a picture, not the picture', () => {
    // A frame cut off by the photo's bottom edge, a picture inside it.
    const rgba = wall()
    paint(rgba, (x, y) => x >= 200 && x < 560 && y >= 110, 35)
    paint(rgba, (x, y) => x >= 216 && x < 544 && y >= 126, 60)
    const scan = findShapes(rgba, W, H)
    const frameBox = { x0: 195 / W, y0: 105 / H, x1: 565 / W, y1: 1 }
    const pictureBox = { x0: 214 / W, y0: 124 / H, x1: 546 / W, y1: 1 }
    expect(bestInBox(scan, frameBox)!.shape.corners[0].x * W).toBeCloseTo(200, -1)
    expect(bestInBox(scan, pictureBox)!.shape.corners[0].x * W).toBeCloseTo(216, -1)
    expect(bestInBox(scan, { x0: 0.02, y0: 0.4, x1: 0.1, y1: 0.5 })).toBeNull()
  })
})

describe('combineShapes', () => {
  it('makes two halves of a door one four-sided shape', () => {
    const rgba = wall()
    paint(rgba, (x, y) => x >= 200 && x < 300 && y >= 60 && y < 300, 40)
    paint(rgba, (x, y) => x >= 302 && x < 400 && y >= 60 && y < 300, 70)
    const scan = findShapes(rgba, W, H)
    const halves = scan.shapes.filter((s) => s.kind === 'quad' && s.area < 0.12)
    expect(halves).toHaveLength(2)
    const door = combineShapes(scan, halves.map((s) => s.id))!
    expect(door.kind).toBe('quad')
    expect(door.corners[0].x * W).toBeCloseTo(200, -1)
    expect(door.corners[1].x * W).toBeCloseTo(400, -1)
    expect(door.id).toBe(`shape-${scan.shapes.length}`)
    // The halves stay in the scan, so undo can bring them back.
    expect(scan.regions.has(halves[0].id)).toBe(true)
  })

  it('keeps shapes that don’t touch as pieces of one traced shape', () => {
    const rgba = wall()
    paint(rgba, (x, y) => Math.hypot(x - 150, y - 180) < 50, 40)
    paint(rgba, (x, y) => Math.hypot(x - 480, y - 180) < 50, 40)
    const scan = findShapes(rgba, W, H)
    expect(scan.shapes).toHaveLength(2)
    const both = combineShapes(scan, scan.shapes.map((s) => s.id))!
    expect(both.kind).toBe('outline')
    expect(both.rings).toHaveLength(2)
    expect(both.area).toBeCloseTo(scan.shapes[0].area + scan.shapes[1].area, 3)
  })

  it('needs at least two known shapes', () => {
    const rgba = wall()
    paint(rgba, (x, y) => x >= 100 && x < 200 && y >= 100 && y < 200, 40)
    const scan = findShapes(rgba, W, H)
    expect(combineShapes(scan, ['shape-1'])).toBeNull()
    expect(combineShapes(scan, ['shape-1', 'shape-99'])).toBeNull()
  })
})

describe('regionMask', () => {
  it('lights the shape and darkens the rest, in the surface’s own space', () => {
    const rgba = wall()
    paint(rgba, (x, y) => Math.hypot(x - 320, y - 180) < 80, 50)
    const scan = findShapes(rgba, W, H)
    const shape = scan.shapes[0]
    const mask = regionMask(scan.regions.get(shape.id)!, W, H, shape.corners, 256, 256)!
    expect(mask[128 * 256 + 128]).toBe(255) // centre: inside the circle
    expect(mask[2 * 256 + 2]).toBe(0) // corner of the fitted square: outside it
  })
})

describe('shapeDetectSize', () => {
  it('shrinks big photos to the detection size, keeping the shape', () => {
    expect(shapeDetectSize(2560, 1440)).toEqual({ width: 640, height: 360 })
    expect(shapeDetectSize(320, 200)).toEqual({ width: 320, height: 200 })
  })
})
