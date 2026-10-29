import type { CornerSet } from './types'
import { applyHomography, squareToQuad } from './surfaceGeometry'
import { invertHomography, type Point } from './homography'

/**
 * The scan pattern the projector shows while you take a scan photo: soft
 * light to see the object by, a bright border so you can frame it, and an
 * ArUco marker (ARUCO_MIP_36h12, ids 0–3) inset in each corner. Finding the
 * markers in the photo tells us exactly how the photo lines up with the
 * projector, even when it was taken from off to the side.
 *
 * The four codes are copied from js-aruco2's dictionary so the editor and
 * projector don't need the library; a unit test checks they still match.
 */
const MARKER_CODES = [0xd2b63a09d, 0x6001134e5, 0x1206fbe72, 0xff8ad6cb4]

/** Data cells per side (36 bits); the drawn marker adds a black border and a white margin. */
export const MARKER_CELLS = 6
/** Whole marker, margin included, in cells: 1 white + 1 black + 6 data + 1 black + 1 white. */
export const MARKER_UNITS = MARKER_CELLS + 4

/** Fill and border brightness, 0–255. Gray light shows the object without blowing out the photo. */
export const PATTERN_FILL = 150
export const PATTERN_BORDER = 255

/** Order the markers sit in: top-left, top-right, bottom-right, bottom-left. */
export const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const

/** Row-major 6×6 data bits for marker `id` (true = white). */
export function markerBits(id: number): boolean[] {
  const bits = MARKER_CODES[id].toString(2).padStart(MARKER_CELLS * MARKER_CELLS, '0')
  return [...bits].map((b) => b === '1')
}

export interface MarkerPlacement {
  id: number
  /** Top-left of the whole marker (margin included) and its side, in frame pixels. */
  x: number
  y: number
  size: number
}

/**
 * Where the four markers go in a frame of `width`×`height` pixels: square,
 * 15% of the shorter side, inset 4% from each corner -- big enough to find
 * in a phone photo from across a room, small enough to leave the middle
 * free for the object.
 */
export function markerPlacements(width: number, height: number): MarkerPlacement[] {
  const short = Math.min(width, height)
  const size = Math.round(short * 0.15)
  const inset = Math.round(short * 0.04)
  return [
    { id: 0, x: inset, y: inset, size },
    { id: 1, x: width - inset - size, y: inset, size },
    { id: 2, x: width - inset - size, y: height - inset - size, size },
    { id: 3, x: inset, y: height - inset - size, size }
  ]
}

/**
 * The corners of a marker's black square (what the detector finds), in
 * frame pixels, in the detector's order: the marker's own top-left,
 * top-right, bottom-right, bottom-left.
 */
export function markerSquareCorners(m: MarkerPlacement): Point[] {
  const unit = m.size / MARKER_UNITS
  const x0 = m.x + unit
  const y0 = m.y + unit
  const x1 = m.x + m.size - unit
  const y1 = m.y + m.size - unit
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 }
  ]
}

/**
 * Brightness (0–255) of the pattern at frame pixel (x, y). The projector
 * draws the same thing with rectangles; this per-pixel form is for tests,
 * which render synthetic "photos" of it.
 */
export function patternValue(x: number, y: number, width: number, height: number): number {
  for (const m of markerPlacements(width, height)) {
    if (x < m.x || y < m.y || x >= m.x + m.size || y >= m.y + m.size) continue
    const cx = Math.floor(((x - m.x) / m.size) * MARKER_UNITS)
    const cy = Math.floor(((y - m.y) / m.size) * MARKER_UNITS)
    if (cx === 0 || cy === 0 || cx === MARKER_UNITS - 1 || cy === MARKER_UNITS - 1) return 255
    if (cx === 1 || cy === 1 || cx === MARKER_UNITS - 2 || cy === MARKER_UNITS - 2) return 0
    return markerBits(m.id)[(cy - 2) * MARKER_CELLS + (cx - 2)] ? 255 : 0
  }
  const border = Math.max(2, Math.round(Math.min(width, height) * 0.006))
  if (x < border || y < border || x >= width - border || y >= height - border) return PATTERN_BORDER
  return PATTERN_FILL
}

/**
 * Corners for a surface that shows the scan photo exactly where it came
 * from: every photo pixel lands on the projector pixel that lit it.
 *
 * `frameInPhoto` is where the projector frame's corners are in the photo
 * (0..1 of the photo, TL, TR, BR, BL). The frame→photo homography is the
 * unit square → those corners; inverting it and sending the photo's own
 * corners through gives the surface's corners in frame units (0..1, often
 * outside it, since photos show more than the frame). The surface's
 * perspective warp then reproduces that homography exactly.
 */
export function photoSurfaceCorners(frameInPhoto: CornerSet): CornerSet | null {
  const frameToPhoto = squareToQuad(frameInPhoto)
  const photoToFrame = frameToPhoto && invertHomography(frameToPhoto)
  if (!photoToFrame) return null
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ].map(([u, v]) => {
    const w = photoToFrame.g * u + photoToFrame.h * v + 1
    return w > 0 ? applyHomography(photoToFrame, u, v) : null
  })
  if (corners.some((c) => c === null || !Number.isFinite(c.x) || !Number.isFinite(c.y))) return null
  return corners as CornerSet
}
