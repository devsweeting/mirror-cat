import { describe, expect, it } from 'vitest'
import { rectifiedSize, rectifyQuad } from './rectify'

/** A w×h BGRA image whose blue channel encodes x and green encodes y (0–255). */
function gradient(w: number, h: number): Buffer {
  const buf = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      buf[o] = Math.round((x / (w - 1)) * 255)
      buf[o + 1] = Math.round((y / (h - 1)) * 255)
      buf[o + 2] = 128
      buf[o + 3] = 255
    }
  }
  return buf
}

const px = (buf: Buffer, w: number, x: number, y: number) => {
  const o = (y * w + x) * 4
  return { b: buf[o], g: buf[o + 1], r: buf[o + 2], a: buf[o + 3] }
}

describe('rectifyQuad', () => {
  it('copies the photo when the frame is the whole photo', () => {
    const src = gradient(64, 48)
    const out = rectifyQuad(
      src,
      64,
      48,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ],
      64,
      48
    )!
    expect(out.equals(src)).toBe(true)
  })

  it('crops to the middle of the photo when the frame is there', () => {
    const src = gradient(200, 200)
    // Frame covers x 25%–75%, y 25%–75% of the photo.
    const out = rectifyQuad(
      src,
      200,
      200,
      [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.25 },
        { x: 0.75, y: 0.75 },
        { x: 0.25, y: 0.75 }
      ],
      100,
      100
    )!
    // Output's left edge ≈ photo x 25% (blue ≈ 64), right edge ≈ 75% (≈ 191).
    expect(Math.abs(px(out, 100, 0, 50).b - 64)).toBeLessThan(3)
    expect(Math.abs(px(out, 100, 99, 50).b - 191)).toBeLessThan(3)
    expect(Math.abs(px(out, 100, 50, 0).g - 64)).toBeLessThan(3)
    expect(Math.abs(px(out, 100, 50, 99).g - 191)).toBeLessThan(3)
    expect(px(out, 100, 50, 50).r).toBe(128)
  })

  it('undoes perspective: a slanted frame comes out as an even gradient', () => {
    const src = gradient(400, 300)
    const out = rectifyQuad(
      src,
      400,
      300,
      [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.2 },
        { x: 0.9, y: 0.8 },
        { x: 0.1, y: 0.9 }
      ],
      160,
      90
    )!
    // Along the middle row, blue should rise monotonically from left to right.
    let previous = -1
    for (let x = 0; x < 160; x += 8) {
      const b = px(out, 160, x, 45).b
      expect(b).toBeGreaterThan(previous)
      previous = b
    }
  })

  it('paints outside-the-photo areas black and refuses non-convex corners', () => {
    const src = gradient(50, 50)
    const out = rectifyQuad(
      src,
      50,
      50,
      [
        { x: -0.5, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: -0.5, y: 1 }
      ],
      30,
      10
    )!
    expect(px(out, 30, 0, 5)).toEqual({ b: 0, g: 0, r: 0, a: 255 })
    expect(
      rectifyQuad(src, 50, 50, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 }
      ], 10, 10)
    ).toBeNull()
  })
})

describe('rectifiedSize', () => {
  it('keeps the frame shape, capped at the longest side', () => {
    expect(rectifiedSize(1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(rectifiedSize(3840, 2160)).toEqual({ width: 2560, height: 1440 })
  })
})
