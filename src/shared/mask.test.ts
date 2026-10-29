import { describe, expect, it } from 'vitest'
import {
  MASK_FIELD_RANGE,
  MAX_MASK_FEATHER,
  MAX_MASK_GROW,
  decodeFieldValue,
  encodeSignedDistanceField,
  fieldSize,
  maskGrayFromRgba,
  normalizeMask
} from './mask'

const ID = 'a'.repeat(64)

/** w×h gray mask, lit (255) where `lit(x, y)`. */
function gray(w: number, h: number, lit: (x: number, y: number) => boolean): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = lit(x, y) ? 255 : 0
  return out
}

describe('normalizeMask', () => {
  it('keeps a valid mask', () => {
    expect(normalizeMask({ id: ID, invert: true, grow: 0.02, feather: 0.03 })).toEqual({
      id: ID,
      invert: true,
      grow: 0.02,
      feather: 0.03
    })
  })

  it('rejects missing or malformed ids', () => {
    expect(normalizeMask(null)).toBeNull()
    expect(normalizeMask({})).toBeNull()
    expect(normalizeMask({ id: '../../etc/passwd' })).toBeNull()
    expect(normalizeMask({ id: ID.toUpperCase() })).toBeNull()
  })

  it('clamps grow and feather, and defaults junk', () => {
    const m = normalizeMask({ id: ID, grow: 9, feather: -1, invert: 'yes' })!
    expect(m.grow).toBe(MAX_MASK_GROW)
    expect(m.feather).toBe(0)
    expect(m.invert).toBe(false)
    expect(normalizeMask({ id: ID, grow: NaN, feather: 99 })!.feather).toBe(MAX_MASK_FEATHER)
    expect(normalizeMask({ id: ID, grow: NaN })!.grow).toBe(0)
  })
})

describe('maskGrayFromRgba', () => {
  it('uses brightness for opaque images', () => {
    const rgba = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255])
    expect(Array.from(maskGrayFromRgba(rgba))).toEqual([255, 0])
  })

  it('uses alpha for cut-outs, whatever the color', () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0])
    expect(Array.from(maskGrayFromRgba(rgba))).toEqual([255, 0])
  })
})

describe('fieldSize', () => {
  it('keeps the aspect and caps the longest side', () => {
    expect(fieldSize(4000, 2000, 1024)).toEqual({ width: 1024, height: 512 })
    expect(fieldSize(300, 200, 1024)).toEqual({ width: 300, height: 200 })
  })
})

describe('encodeSignedDistanceField', () => {
  const w = 100
  const h = 100
  // Left half lit: the edge runs down x = 50.
  const field = encodeSignedDistanceField(
    gray(w, h, (x) => x < 50),
    w,
    h
  )
  const at = (x: number, y = 50): number => decodeFieldValue(field[y * w + x])

  it('is positive inside, negative outside, ~0 at the edge', () => {
    expect(at(49)).toBeGreaterThan(0)
    expect(at(50)).toBeLessThan(0)
    expect(Math.abs(at(49))).toBeLessThan(0.01)
    expect(Math.abs(at(50))).toBeLessThan(0.01)
  })

  it('measures distance as a fraction of the shorter side', () => {
    // The edge is at x = 50; pixel centers sit at x + 0.5. Pixel 40 is
    // 9.5 px inside, pixel 60 is 10.5 px outside, of a 100 px mask.
    expect(at(40)).toBeCloseTo(0.095, 2)
    expect(at(60)).toBeCloseTo(-0.105, 2)
  })

  it('saturates beyond the encoded range', () => {
    expect(at(0)).toBeCloseTo(MASK_FIELD_RANGE, 2)
    expect(at(99)).toBeCloseTo(-MASK_FIELD_RANGE, 2)
  })

  it('handles an all-lit and an all-dark mask', () => {
    const lit = encodeSignedDistanceField(gray(8, 8, () => true), 8, 8)
    const dark = encodeSignedDistanceField(gray(8, 8, () => false), 8, 8)
    expect(lit.every((v) => v === 255)).toBe(true)
    expect(dark.every((v) => v === 0)).toBe(true)
  })

  it('a plain black/white image already crosses the edge at the midpoint', () => {
    // What the live paint preview relies on.
    expect(decodeFieldValue(255)).toBeCloseTo(MASK_FIELD_RANGE)
    expect(decodeFieldValue(0)).toBeCloseTo(-MASK_FIELD_RANGE)
  })
})
