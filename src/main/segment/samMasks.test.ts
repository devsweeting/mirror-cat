import { describe, expect, it } from 'vitest'
import { SAM_MASK_SIZE, SAM_SIZE, gridPoints, logitsToMask, preprocessBgra, stabilityScore } from './samMasks'

const S = SAM_MASK_SIZE

/** Logits for a disc of radius r (in mask cells) at the middle: +4 inside, −4 outside. */
function disc(r: number, count = 1): Float32Array {
  const out = new Float32Array(count * S * S)
  for (let k = 0; k < count; k++) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        out[k * S * S + y * S + x] = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) < r ? 4 : -4
      }
    }
  }
  return out
}

describe('preprocessBgra', () => {
  it('turns BGRA into normalized RGB planes', () => {
    const bgra = new Uint8Array(SAM_SIZE * SAM_SIZE * 4)
    bgra.set([0, 128, 255, 255], 0) // first pixel: R 255, G 128, B 0
    const out = preprocessBgra(bgra)
    const n = SAM_SIZE * SAM_SIZE
    expect(out[0]).toBeCloseTo((1 - 0.485) / 0.229, 4)
    expect(out[n]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 4)
    expect(out[2 * n]).toBeCloseTo((0 - 0.406) / 0.225, 4)
  })
})

describe('logitsToMask', () => {
  it('scales the 256² answer to any size, here a frame-shaped one', () => {
    const mask = logitsToMask(disc(64, 2), 1, 640, 360)
    expect(mask[180 * 640 + 320]).toBe(1)
    expect(mask[5 * 640 + 5]).toBe(0)
    // The disc covers a quarter of the width (a squashed circle in a wide frame).
    let row = 0
    for (let x = 0; x < 640; x++) row += mask[180 * 640 + x]
    expect(Math.abs(row - 320)).toBeLessThan(6)
  })
})

describe('stabilityScore', () => {
  it('is 1 for a crisp mask and low for a vague one', () => {
    expect(stabilityScore(disc(50), 0)).toBe(1)
    const vague = new Float32Array(S * S).map((_, i) => ((i % S) / S) * 2 - 1.2) // a slow ramp
    expect(stabilityScore(vague, 0)).toBeLessThan(0.5)
  })
})

describe('gridPoints', () => {
  it('spreads points across the frame, more columns than rows for a wide frame', () => {
    const points = gridPoints(1920, 1080, 10)
    expect(points).toHaveLength(60)
    expect(points[0]).toEqual([51.2, 1024 / 12])
    expect(points.every(([x, y]) => x > 0 && x < 1024 && y > 0 && y < 1024)).toBe(true)
  })
})
