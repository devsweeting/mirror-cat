import { applyHomography, squareToQuad } from '../../shared/surfaceGeometry'
import type { CornerSet } from '../../shared/types'

/**
 * Straighten the part of a photo inside a quadrilateral into a rectangle:
 * the projector frame as the photo saw it (slanted, if taken off to the
 * side) becomes a `outWidth`×`outHeight` image that fills the frame exactly.
 *
 * `frameInPhoto` is the frame's corners in the photo, 0..1 (TL, TR, BR,
 * BL). For each output pixel the unit-square → quad homography gives the
 * photo point it came from, sampled bilinearly. Pixels are 4 bytes each in
 * the caller's channel order (BGRA from Electron in, BGRA out). Points
 * outside the photo come out black -- unlit, on a projector.
 *
 * Returns null when the corners don't make a convex shape.
 */
export function rectifyQuad(
  src: Uint8Array | Buffer,
  srcWidth: number,
  srcHeight: number,
  frameInPhoto: CornerSet,
  outWidth: number,
  outHeight: number
): Buffer | null {
  const map = squareToQuad(frameInPhoto)
  if (!map) return null
  const out = Buffer.alloc(outWidth * outHeight * 4)
  const maxX = srcWidth - 1
  const maxY = srcHeight - 1
  let o = 0
  for (let y = 0; y < outHeight; y++) {
    const v = (y + 0.5) / outHeight
    for (let x = 0; x < outWidth; x++) {
      const p = applyHomography(map, (x + 0.5) / outWidth, v)
      const sx = p.x * srcWidth - 0.5
      const sy = p.y * srcHeight - 0.5
      if (sx < -0.5 || sy < -0.5 || sx > maxX + 0.5 || sy > maxY + 0.5) {
        out[o + 3] = 255
        o += 4
        continue
      }
      const x0 = Math.max(0, Math.min(maxX, Math.floor(sx)))
      const y0 = Math.max(0, Math.min(maxY, Math.floor(sy)))
      const x1 = Math.min(maxX, x0 + 1)
      const y1 = Math.min(maxY, y0 + 1)
      const fx = Math.min(1, Math.max(0, sx - x0))
      const fy = Math.min(1, Math.max(0, sy - y0))
      const i00 = (y0 * srcWidth + x0) * 4
      const i10 = (y0 * srcWidth + x1) * 4
      const i01 = (y1 * srcWidth + x0) * 4
      const i11 = (y1 * srcWidth + x1) * 4
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx
        const bottom = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx
        out[o + c] = Math.round(top + (bottom - top) * fy)
      }
      out[o + 3] = 255
      o += 4
    }
  }
  return out
}

/** Output size for a straightened frame: the frame's shape, longest side ≤ maxEdge. */
export function rectifiedSize(
  frameWidth: number,
  frameHeight: number,
  maxEdge = 2560
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(frameWidth, frameHeight))
  return {
    width: Math.max(1, Math.round(frameWidth * scale)),
    height: Math.max(1, Math.round(frameHeight * scale))
  }
}
