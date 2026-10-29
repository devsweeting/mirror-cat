import aruco from 'js-aruco2'
import { applyHomography } from '../../shared/surfaceGeometry'
import { fitHomography, type Point } from '../../shared/homography'
import { markerPlacements, markerSquareCorners } from '../../shared/scanPattern'
import type { FrameDetection } from '../../shared/capture'

// CommonJS package: its namespace arrives on the default export.
const { AR } = aruco

/** Longest side photos are scanned at; plenty for markers 15% of the frame. */
export const DETECT_MAX_EDGE = 1600

/**
 * Find the projector frame in a photo of the scan pattern.
 *
 * Detects the four corner markers, pairs each found marker's four corners
 * with where that marker was drawn in the frame, and fits one homography
 * (frame pixels → photo pixels) through all the pairs -- 16 points with
 * every marker found, which averages out detection noise. The frame's
 * corners then come out of that homography, so a marker that's partly
 * hidden (by the object, say) doesn't stop it working.
 *
 * Two or more markers give a usable answer; with three or fewer it's
 * flagged `estimated` so the editor can ask you to check. `rgba` is the
 * photo's pixels; `frameWidth`×`frameHeight` is the projector frame the
 * pattern was drawn in.
 */
export function locateFrame(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  frameWidth: number,
  frameHeight: number
): FrameDetection {
  const detector = new AR.Detector({ dictionaryName: 'ARUCO_MIP_36h12' })
  const markers = detector.detect({ width, height, data: rgba })
  const placements = markerPlacements(frameWidth, frameHeight)

  const found = new Map<number, Point[]>()
  for (const marker of markers) {
    if (marker.id >= 0 && marker.id < 4 && !found.has(marker.id)) found.set(marker.id, marker.corners)
  }

  const pairs: { from: Point; to: Point }[] = []
  for (const [id, corners] of found) {
    const drawn = markerSquareCorners(placements[id])
    for (let k = 0; k < 4; k++) pairs.push({ from: drawn[k], to: corners[k] })
  }

  const markersFound = [...found.keys()].sort()
  if (found.size < 2) return { corners: null, markersFound, estimated: true }
  const frameToPhoto = fitHomography(pairs)
  if (!frameToPhoto) return { corners: null, markersFound, estimated: true }

  const corners = [
    [0, 0],
    [frameWidth, 0],
    [frameWidth, frameHeight],
    [0, frameHeight]
  ].map(([x, y]) => {
    const p = applyHomography(frameToPhoto, x, y)
    return { x: p.x / width, y: p.y / height }
  })
  if (corners.some((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y))) {
    return { corners: null, markersFound, estimated: true }
  }
  return {
    corners: corners as FrameDetection['corners'],
    markersFound,
    estimated: found.size < 4
  }
}

/** Size to scan a photo at: same aspect, longest side ≤ DETECT_MAX_EDGE. */
export function detectSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, DETECT_MAX_EDGE / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Electron's BGRA bitmap → RGBA, in place. */
export function bgraToRgba(pixels: Buffer): Buffer {
  for (let i = 0; i < pixels.length; i += 4) {
    const b = pixels[i]
    pixels[i] = pixels[i + 2]
    pixels[i + 2] = b
  }
  return pixels
}
