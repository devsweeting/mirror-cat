import { describe, expect, it } from 'vitest'
import aruco from 'js-aruco2'
import { applyHomography } from '../../shared/surfaceGeometry'
import { fitHomography, invertHomography } from '../../shared/homography'
import { markerBits, markerPlacements, patternValue } from '../../shared/scanPattern'
import { locateFrame } from './frameDetect'

// CommonJS package: its namespace arrives on the default export.
const { AR } = aruco

const FRAME_W = 1280
const FRAME_H = 800
const PHOTO_W = 1600
const PHOTO_H = 1200

/** Where the projector frame's corners land in the synthetic photo (taken off to one side). */
const FRAME_IN_PHOTO = [
  { x: 210, y: 160 },
  { x: 1440, y: 250 },
  { x: 1370, y: 1040 },
  { x: 260, y: 975 }
]

/**
 * Render a "photo" of the scan pattern: every photo pixel is mapped back
 * into the frame and takes the pattern's brightness there (a dim room
 * outside the frame), with a little sensor noise.
 */
function renderPhoto(hide?: (frameX: number, frameY: number) => boolean): Uint8ClampedArray {
  const frameToPhoto = fitHomography(
    [
      { x: 0, y: 0 },
      { x: FRAME_W, y: 0 },
      { x: FRAME_W, y: FRAME_H },
      { x: 0, y: FRAME_H }
    ].map((from, i) => ({ from, to: FRAME_IN_PHOTO[i] }))
  )!
  const photoToFrame = invertHomography(frameToPhoto)!
  const rgba = new Uint8ClampedArray(PHOTO_W * PHOTO_H * 4)
  let seed = 7
  const noise = (): number => {
    seed = (seed * 16807) % 2147483647
    return (seed / 2147483647 - 0.5) * 16
  }
  for (let y = 0; y < PHOTO_H; y++) {
    for (let x = 0; x < PHOTO_W; x++) {
      const f = applyHomography(photoToFrame, x + 0.5, y + 0.5)
      let v = 28
      if (f.x >= 0 && f.y >= 0 && f.x < FRAME_W && f.y < FRAME_H) {
        // Projected light never reaches true black or white on a wall.
        v = hide?.(f.x, f.y) ? 110 : 30 + (patternValue(f.x, f.y, FRAME_W, FRAME_H) / 255) * 190
      }
      v += noise()
      const o = (y * PHOTO_W + x) * 4
      rgba[o] = rgba[o + 1] = rgba[o + 2] = v
      rgba[o + 3] = 255
    }
  }
  return rgba
}

function expectCornersNear(
  corners: { x: number; y: number }[] | null,
  tolerancePx: number
): void {
  expect(corners).not.toBeNull()
  corners!.forEach((c, i) => {
    expect(Math.abs(c.x * PHOTO_W - FRAME_IN_PHOTO[i].x)).toBeLessThan(tolerancePx)
    expect(Math.abs(c.y * PHOTO_H - FRAME_IN_PHOTO[i].y)).toBeLessThan(tolerancePx)
  })
}

describe('scan pattern markers', () => {
  it('match js-aruco2’s ARUCO_MIP_36h12 codes for ids 0–3', () => {
    const dictionary = new AR.Dictionary('ARUCO_MIP_36h12')
    for (let id = 0; id < 4; id++) {
      const bits = markerBits(id)
        .map((b) => (b ? '1' : '0'))
        .join('')
      expect(bits).toBe(dictionary.codeList[id])
    }
  })

  it('places four non-overlapping markers inside the frame', () => {
    const placements = markerPlacements(FRAME_W, FRAME_H)
    expect(placements.map((p) => p.id)).toEqual([0, 1, 2, 3])
    for (const p of placements) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.y).toBeGreaterThan(0)
      expect(p.x + p.size).toBeLessThan(FRAME_W)
      expect(p.y + p.size).toBeLessThan(FRAME_H)
    }
  })
})

describe('locateFrame', () => {
  it('finds all four markers and the frame in an off-axis photo', () => {
    const result = locateFrame(renderPhoto(), PHOTO_W, PHOTO_H, FRAME_W, FRAME_H)
    expect(result.markersFound).toEqual([0, 1, 2, 3])
    expect(result.estimated).toBe(false)
    expectCornersNear(result.corners, 6)
  })

  it('still places the frame when one marker is hidden, and says it is estimated', () => {
    const hidden = markerPlacements(FRAME_W, FRAME_H)[2]
    const result = locateFrame(
      renderPhoto(
        (x, y) =>
          x >= hidden.x - 10 && y >= hidden.y - 10 && x < hidden.x + hidden.size + 10 && y < hidden.y + hidden.size + 10
      ),
      PHOTO_W,
      PHOTO_H,
      FRAME_W,
      FRAME_H
    )
    expect(result.markersFound).toEqual([0, 1, 3])
    expect(result.estimated).toBe(true)
    expectCornersNear(result.corners, 12)
  })

  it('gives up (no corners) when the pattern isn’t in the photo', () => {
    const blank = new Uint8ClampedArray(400 * 300 * 4).fill(90)
    const result = locateFrame(blank, 400, 300, FRAME_W, FRAME_H)
    expect(result.corners).toBeNull()
    expect(result.markersFound).toEqual([])
  })
})
