import type { Point } from '../../shared/homography'
import { markerPlacements } from '../../shared/scanPattern'
import {
  MAX_SHAPES,
  convexHull,
  fitQuad,
  minAreaRect,
  orderCorners,
  polygonArea,
  simplifyClosed,
  type DetectedShape
} from '../../shared/shapes'
import { applyHomography, squareToQuad } from '../../shared/surfaceGeometry'
import type { CornerSet } from '../../shared/types'

/**
 * Built-in shape finding (stage 1): flat, solid shapes in a scan photo
 * that's already been fitted to the projector frame.
 *
 * Three passes each split the picture into regions, and every region that
 * looks like an object becomes a candidate:
 *
 * 1. Faces between edges: Sobel edges, then each area they enclose. Finds
 *    box sides, frames, doors and panels even when they're the same
 *    brightness as the wall.
 * 2. and 3. Brighter and darker than the picture overall (Otsu): finds
 *    objects with soft edges against a plain wall.
 *
 * Candidates are kept if they're a sensible size, not the background (it
 * touches two or more sides) and not one of the scan pattern's corner
 * markers. Close duplicates across passes are merged, preferring clean
 * four-sided fits. A stage 2 model (SAM 2) can feed the same picker: it
 * only has to produce regions.
 */

/** Detection runs on a copy this size: plenty for surface corners, ~50 ms. */
export const SHAPE_MAX_EDGE = 640

const MIN_AREA = 0.004
const MAX_AREA = 0.8
const MIN_SOLIDITY = 0.6
// Same region found by two passes overlaps ~0.95; a frame and the picture
// inside it overlap ~0.8 and are both worth offering.
const DUPLICATE_IOU = 0.88

/** A shape's pixels (holes filled), cropped to its box, in detection pixels. */
export interface Region {
  x: number
  y: number
  width: number
  height: number
  /** 1 inside, 0 outside, row-major. */
  data: Uint8Array
  count: number
}

export interface ShapeScan {
  width: number
  height: number
  shapes: DetectedShape[]
  /** By shape id, for making exact masks later. */
  regions: Map<string, Region>
  /** Every candidate before duplicates were merged: a box can pick from these. */
  pool: Candidate[]
}

/** A normalized box (0..1 of the frame) drawn around something. */
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function shapeDetectSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, SHAPE_MAX_EDGE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function findShapes(rgba: Uint8Array, width: number, height: number): ShapeScan {
  const gray = toGray(rgba, width, height)
  const smooth = boxBlur(boxBlur(gray, width, height, 1), width, height, 1)
  const candidates: Candidate[] = []
  const markers = markerZones(width, height)

  const edges = dilate(edgeMask(smooth, width, height), width, height, 0, 0, width, height)
  const faces = new Uint8Array(edges.length)
  for (let i = 0; i < edges.length; i++) faces[i] = edges[i] ? 0 : 1
  collect(faces, width, height, 2, 0.05, markers, candidates)

  const t = otsu(smooth)
  const light = new Uint8Array(smooth.length)
  const dark = new Uint8Array(smooth.length)
  for (let i = 0; i < smooth.length; i++) {
    light[i] = smooth[i] > t ? 1 : 0
    dark[i] = smooth[i] > t ? 0 : 1
  }
  collect(light, width, height, 0, 0, markers, candidates)
  collect(dark, width, height, 0, 0, markers, candidates)

  const pool = [...candidates]
  // Best first, then drop anything that's mostly a shape already kept.
  candidates.sort((a, b) => b.score - a.score)
  const kept: Candidate[] = []
  for (const c of candidates) {
    if (kept.every((k) => iou(k.region, c.region) < DUPLICATE_IOU)) kept.push(c)
  }
  // The biggest few, numbered in reading order.
  const chosen = kept.sort((a, b) => b.region.count - a.region.count).slice(0, MAX_SHAPES)
  const band = height * 0.1
  chosen.sort((a, b) => Math.round(a.cy / band) - Math.round(b.cy / band) || a.cx - b.cx)

  const shapes: DetectedShape[] = []
  const regions = new Map<string, Region>()
  chosen.forEach((c, i) => {
    const id = `shape-${i + 1}`
    shapes.push({ ...c.shape, id })
    regions.set(id, c.region)
  })
  return { width, height, shapes, regions, pool }
}

/**
 * A candidate from a whole-picture mask (a SAM 2 answer, 1 = inside, at
 * the scan's size): its largest piece, holes filled, fitted like any other
 * region. Organic shapes are allowed to be less solid than the built-in
 * finder's. `maxBorders` is how many photo sides it may touch.
 */
export function candidateFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  {
    minSolidity = 0.35,
    maxBorders = 1,
    maxArea = MAX_AREA
  }: { minSolidity?: number; maxBorders?: number; maxArea?: number } = {}
): Candidate | null {
  const total = width * height
  const { labels, components } = label(mask, width, height)
  let biggest: Component | null = null
  for (const c of components) if (!biggest || c.count > biggest.count) biggest = c
  if (!biggest || biggest.count < total * MIN_AREA || biggest.count > total * maxArea) return null
  if (bitCount(biggest.borders) > maxBorders) return null
  const region = regionOf(labels, biggest, width, height, 0)
  if (region.count > total * maxArea) return null
  const candidate = describe(region, width, height, 0.1, minSolidity)
  if (!candidate) return null
  const markers = markerZones(width, height)
  if (markers.some((z) => candidate.cx > z.x0 && candidate.cx < z.x1 && candidate.cy > z.y0 && candidate.cy < z.y1)) {
    return null
  }
  return candidate
}

/**
 * Add candidates to a scan as new shapes (numbered after the ones it has).
 * One that's mostly a shape already there comes back in `existing`
 * instead, so a box drawn around a known shape just picks it.
 */
export function addCandidates(
  scan: ShapeScan,
  candidates: Candidate[],
  limit = MAX_SHAPES
): { added: DetectedShape[]; existing: DetectedShape[] } {
  const added: DetectedShape[] = []
  const existing: DetectedShape[] = []
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    const match = scan.shapes.find((s) => iou(scan.regions.get(s.id)!, c.region) >= DUPLICATE_IOU)
    if (match) {
      if (!existing.includes(match) && !added.includes(match)) existing.push(match)
      continue
    }
    if (added.length >= limit) continue
    const shape: DetectedShape = { ...c.shape, id: nextShapeId(scan) }
    scan.shapes.push(shape)
    scan.regions.set(shape.id, c.region)
    added.push(shape)
  }
  return { added, existing }
}

/**
 * The built-in finder's best answer for a box: the candidate (from any
 * pass, merged or not) whose outline's bounds match the box best. Null
 * when nothing matches it at least half.
 */
export function bestInBox(scan: ShapeScan, box: Box): Candidate | null {
  let best: Candidate | null = null
  let bestScore = 0.5
  for (const c of scan.pool) {
    const xs = c.shape.outline.map((p) => p.x)
    const ys = c.shape.outline.map((p) => p.y)
    const score = boxIou(box, { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) })
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

function boxIou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
  const both = ix * iy
  const area = (r: Box): number => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0)
  return both / Math.max(1e-9, area(a) + area(b) - both)
}

export interface Candidate {
  shape: Omit<DetectedShape, 'id'>
  region: Region
  score: number
  cx: number
  cy: number
}

function collect(
  mask: Uint8Array,
  width: number,
  height: number,
  grow: number,
  bonus: number,
  markers: Zone[],
  out: Candidate[]
): void {
  const total = width * height
  const { labels, components } = label(mask, width, height)
  for (const comp of components) {
    if (comp.count < total * MIN_AREA || comp.count > total * MAX_AREA) continue
    if (bitCount(comp.borders) >= 2) continue
    const region = regionOf(labels, comp, width, height, grow)
    if (region.count > total * MAX_AREA) continue
    const candidate = describe(region, width, height, bonus)
    if (!candidate) continue
    if (markers.some((z) => candidate.cx > z.x0 && candidate.cx < z.x1 && candidate.cy > z.y0 && candidate.cy < z.y1)) {
      continue
    }
    out.push(candidate)
  }
}

function describe(
  region: Region,
  width: number,
  height: number,
  bonus: number,
  minSolidity = MIN_SOLIDITY
): Candidate | null {
  return fit(region, [traceOutline(region)], width, height, bonus, minSolidity)
}

/**
 * Fit a region whose outline is one or more rings (several when shapes
 * that don't touch are combined): a quad if its hull is close to
 * four-sided and it fills it, else a traced shape in a padded rectangle.
 */
function fit(
  region: Region,
  rings: Point[][],
  width: number,
  height: number,
  bonus: number,
  minSolidity: number
): Candidate | null {
  const kept = rings.filter((r) => r.length >= 8)
  if (kept.length === 0) return null
  const all = kept.flat()
  const hull = convexHull(all)
  const hullArea = polygonArea(hull)
  // Pixel counts include half a pixel around the traced centres.
  const solidity = region.count / (hullArea + perimeter(hull) / 2 + 1)
  if (solidity < minSolidity) return null

  let cx = 0
  let cy = 0
  for (const p of all) {
    cx += p.x
    cy += p.y
  }
  cx /= all.length
  cy /= all.length

  const norm = (p: Point): Point => ({ x: (p.x + 0.5) / width, y: (p.y + 0.5) / height })
  const quad = solidity > 0.88 ? fitQuad(hull, all) : null
  const quadArea = quad ? polygonArea(quad) : 0
  const isQuad = quad !== null && quadArea > hullArea * 0.92 && quadArea < hullArea * 1.1
  // A traced shape's rectangle gets a few pixels of room, so the mask's soft
  // edge isn't cut off where the shape touches the rectangle.
  const fitted = isQuad ? quad! : padded(minAreaRect(hull), 3)
  const corners = orderCorners(fitted.map(norm))
  if (!squareToQuad(corners)) return null
  const traced = kept
    .sort((a, b) => polygonArea(b) - polygonArea(a))
    .map((r) => simplifyClosed(r, 1.2).map(norm))
  const shape: Omit<DetectedShape, 'id'> = {
    kind: isQuad ? 'quad' : 'outline',
    corners,
    outline: isQuad ? corners.map((c) => ({ ...c })) : traced[0],
    area: region.count / (width * height)
  }
  if (!isQuad && traced.length > 1) shape.rings = traced
  return { shape, region, score: (isQuad ? 1 : 0) + solidity + bonus, cx, cy }
}

/**
 * Several shapes as one: their pixels together, fitted afresh (two halves
 * of a door become a door; a lamp's shade and base one cut-out). Shapes
 * that don't touch stay separate pieces of one surface's mask. The parts
 * stay in the scan, so undo can bring them back.
 */
export function combineShapes(scan: ShapeScan, ids: string[]): DetectedShape | null {
  const parts = [...new Set(ids)].map((id) => scan.regions.get(id)).filter((r): r is Region => Boolean(r))
  if (parts.length < 2) return null
  const x0 = Math.min(...parts.map((r) => r.x))
  const y0 = Math.min(...parts.map((r) => r.y))
  const w = Math.max(...parts.map((r) => r.x + r.width)) - x0
  const h = Math.max(...parts.map((r) => r.y + r.height)) - y0
  const data = new Uint8Array(w * h)
  for (const r of parts) {
    for (let y = 0; y < r.height; y++) {
      const row = (y + r.y - y0) * w + r.x - x0
      for (let x = 0; x < r.width; x++) if (r.data[y * r.width + x]) data[row + x] = 1
    }
  }
  let count = 0
  for (const v of data) count += v
  const region: Region = { x: x0, y: y0, width: w, height: h, data, count }

  // Trace each piece on its own.
  const { labels, components } = label(data, w, h)
  const rings = components
    .filter((c) => c.count >= 20)
    .map((c) => {
      const piece = regionOf(labels, c, w, h, 0)
      return traceOutline({ ...piece, x: piece.x + x0, y: piece.y + y0 })
    })
  const candidate = fit(region, rings, scan.width, scan.height, 0, 0)
  if (!candidate) return null
  const shape: DetectedShape = { ...candidate.shape, id: nextShapeId(scan) }
  scan.shapes.push(shape)
  scan.regions.set(shape.id, region)
  return shape
}

function nextShapeId(scan: ShapeScan): string {
  return `shape-${scan.shapes.reduce((n, s) => Math.max(n, Number(s.id.replace(/\D/g, '')) || 0), 0) + 1}`
}

/**
 * An exact mask for a shape on a surface with these corners: for each
 * mask pixel, where it lands in the frame, and whether that's inside the
 * shape. Softened by about one detection pixel so the upscale isn't
 * stair-stepped. Returns 8-bit gray, white = lit.
 */
export function regionMask(
  region: Region,
  scanWidth: number,
  scanHeight: number,
  corners: CornerSet,
  outWidth: number,
  outHeight: number
): Uint8Array | null {
  const h = squareToQuad(corners)
  if (!h) return null
  const out = new Uint8Array(outWidth * outHeight)
  const { data, width: rw, height: rh } = region
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= rw || y >= rh ? 0 : data[y * rw + x])
  for (let j = 0; j < outHeight; j++) {
    for (let i = 0; i < outWidth; i++) {
      const p = applyHomography(h, (i + 0.5) / outWidth, (j + 0.5) / outHeight)
      const x = p.x * scanWidth - 0.5 - region.x
      const y = p.y * scanHeight - 0.5 - region.y
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const fy = y - y0
      const v =
        (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
        (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
      out[j * outWidth + i] = Math.round(v * 255)
    }
  }
  const across = Math.hypot((corners[1].x - corners[0].x) * scanWidth, (corners[1].y - corners[0].y) * scanHeight)
  const radius = Math.max(1, Math.min(8, Math.round(outWidth / Math.max(1, across) / 2)))
  return boxBlur(boxBlur(out, outWidth, outHeight, radius), outWidth, outHeight, radius)
}

// ---------- Image basics ----------

function toGray(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height)
  for (let i = 0, o = 0; i < gray.length; i++, o += 4) {
    gray[i] = (rgba[o] * 0.299 + rgba[o + 1] * 0.587 + rgba[o + 2] * 0.114 + 0.5) | 0
  }
  return gray
}

/** Box blur of radius r (separable running sums, edges clamped). */
export function boxBlur(src: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length)
  const out = new Uint8Array(src.length)
  const n = 2 * r + 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(width - 1, Math.max(0, k))]
    for (let x = 0; x < width; x++) {
      tmp[row + x] = (sum / n + 0.5) | 0
      sum += src[row + Math.min(width - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(height - 1, Math.max(0, k)) * width + x]
    for (let y = 0; y < height; y++) {
      out[y * width + x] = (sum / n + 0.5) | 0
      sum += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x]
    }
  }
  return out
}

/** Sobel edges, thresholded relative to the picture's own contrast. */
function edgeMask(gray: Uint8Array, width: number, height: number): Uint8Array {
  const mag = new Float32Array(width * height)
  let sum = 0
  let sum2 = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const gx =
        gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1] -
        gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1]
      const gy =
        gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1] -
        gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1]
      const m = Math.hypot(gx, gy)
      mag[i] = m
      sum += m
      sum2 += m * m
    }
  }
  const n = Math.max(1, (width - 2) * (height - 2))
  const mean = sum / n
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean))
  const threshold = Math.max(40, mean + 1.5 * std)
  const out = new Uint8Array(width * height)
  for (let i = 0; i < mag.length; i++) out[i] = mag[i] > threshold ? 1 : 0
  return out
}

function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256)
  for (const v of gray) hist[v]++
  let total = 0
  for (let i = 0; i < 256; i++) total += i * hist[i]
  let below = 0
  let weight = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    weight += hist[t]
    if (weight === 0) continue
    const rest = gray.length - weight
    if (rest === 0) break
    below += t * hist[t]
    const m0 = below / weight
    const m1 = (total - below) / rest
    const between = weight * rest * (m0 - m1) * (m0 - m1)
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

/** 3×3 dilation of the box (x0, y0)–(x1, y1) of a 0/1 mask; a new mask. */
function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Uint8Array {
  const out = new Uint8Array(mask)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (mask[y * width + x]) continue
      for (let dy = -1; dy <= 1 && !out[y * width + x]; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx >= 0 && xx < width && mask[yy * width + xx]) {
            out[y * width + x] = 1
            break
          }
        }
      }
    }
  }
  return out
}

// ---------- Regions ----------

interface Component {
  id: number
  count: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Which image sides it touches: 1 left, 2 right, 4 top, 8 bottom. */
  borders: number
}

/** 4-connected components of the 1s in a mask. Labels start at 1. */
function label(mask: Uint8Array, width: number, height: number): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(width * height)
  const queue = new Int32Array(width * height)
  const components: Component[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue
    const comp: Component = { id: components.length + 1, count: 0, minX: width, minY: height, maxX: 0, maxY: 0, borders: 0 }
    let head = 0
    let tail = 0
    queue[tail++] = start
    labels[start] = comp.id
    while (head < tail) {
      const i = queue[head++]
      const x = i % width
      const y = (i - x) / width
      comp.count++
      if (x < comp.minX) comp.minX = x
      if (x > comp.maxX) comp.maxX = x
      if (y < comp.minY) comp.minY = y
      if (y > comp.maxY) comp.maxY = y
      if (x === 0) comp.borders |= 1
      if (x === width - 1) comp.borders |= 2
      if (y === 0) comp.borders |= 4
      if (y === height - 1) comp.borders |= 8
      if (x > 0 && mask[i - 1] && !labels[i - 1]) {
        labels[i - 1] = comp.id
        queue[tail++] = i - 1
      }
      if (x < width - 1 && mask[i + 1] && !labels[i + 1]) {
        labels[i + 1] = comp.id
        queue[tail++] = i + 1
      }
      if (y > 0 && mask[i - width] && !labels[i - width]) {
        labels[i - width] = comp.id
        queue[tail++] = i - width
      }
      if (y < height - 1 && mask[i + width] && !labels[i + width]) {
        labels[i + width] = comp.id
        queue[tail++] = i + width
      }
    }
    components.push(comp)
  }
  return { labels, components }
}

/** One component as a filled region, grown back over the edge band it was cut by. */
function regionOf(labels: Int32Array, comp: Component, width: number, height: number, grow: number): Region {
  const pad = grow + 1
  const x0 = Math.max(0, comp.minX - pad)
  const y0 = Math.max(0, comp.minY - pad)
  const rw = Math.min(width - 1, comp.maxX + pad) - x0 + 1
  const rh = Math.min(height - 1, comp.maxY + pad) - y0 + 1
  let data: Uint8Array = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (labels[(y + y0) * width + x + x0] === comp.id) data[y * rw + x] = 1
    }
  }
  for (let g = 0; g < grow; g++) data = dilate(data, rw, rh, 0, 0, rw, rh)
  // Where the box meets the photo's edge, the edge closes the shape: a frame
  // cut off by the bottom of the photo still has a middle.
  fillHoles(data, rw, rh, {
    left: x0 > 0,
    right: x0 + rw < width,
    top: y0 > 0,
    bottom: y0 + rh < height
  })
  let count = 0
  for (const v of data) count += v
  return { x: x0, y: y0, width: rw, height: rh, data, count }
}

/**
 * Fill every 0 that can't reach the box's open sides (holes: a picture
 * inside its frame). Sides that are the photo's own edge count as closed.
 */
function fillHoles(
  data: Uint8Array,
  width: number,
  height: number,
  open = { left: true, right: true, top: true, bottom: true }
): void {
  const outside = new Uint8Array(data.length)
  const queue = new Int32Array(data.length)
  let tail = 0
  const seed = (i: number): void => {
    if (!data[i] && !outside[i]) {
      outside[i] = 1
      queue[tail++] = i
    }
  }
  for (let x = 0; x < width; x++) {
    if (open.top) seed(x)
    if (open.bottom) seed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    if (open.left) seed(y * width)
    if (open.right) seed(y * width + width - 1)
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head]
    const x = i % width
    if (x > 0) seed(i - 1)
    if (x < width - 1) seed(i + 1)
    if (i >= width) seed(i - width)
    if (i < data.length - width) seed(i + width)
  }
  for (let i = 0; i < data.length; i++) if (!outside[i]) data[i] = 1
}

/** Clockwise directions on screen: E, SE, S, SW, W, NW, N, NE. */
const DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1]
] as const

/**
 * The region's outer boundary, clockwise, as pixel positions in the scan
 * (Moore-neighbour tracing from its first pixel in reading order).
 */
function traceOutline(region: Region): Point[] {
  const { data, width, height } = region
  const start = data.indexOf(1)
  if (start < 0) return []
  const set = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] === 1
  let x = start % width
  let y = (start - x) / width
  const sx = x
  const sy = y
  const points: Point[] = [{ x: x + region.x, y: y + region.y }]
  let dir = 0
  let firstDir = -1
  const limit = region.count * 4 + 8
  for (let step = 0; step < limit; step++) {
    let next = -1
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8
      if (set(x + DIRS[d][0], y + DIRS[d][1])) {
        next = d
        break
      }
    }
    if (next < 0) break // a single pixel
    if (x === sx && y === sy && step > 0 && next === firstDir) break
    if (firstDir < 0) firstDir = next
    x += DIRS[next][0]
    y += DIRS[next][1]
    dir = next
    if (!(x === sx && y === sy)) points.push({ x: x + region.x, y: y + region.y })
  }
  return points
}

function iou(a: Region, b: Region): number {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.width, b.x + b.width)
  const y1 = Math.min(a.y + a.height, b.y + b.height)
  let both = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      both += a.data[(y - a.y) * a.width + x - a.x] & b.data[(y - b.y) * b.width + x - b.x]
    }
  }
  return both / Math.max(1, a.count + b.count - both)
}

interface Zone {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The scan pattern's corner markers (with some room around them), in scan pixels. */
function markerZones(width: number, height: number): Zone[] {
  return markerPlacements(width, height).map(({ x, y, size }) => {
    const m = size * 0.25
    return { x0: x - m, y0: y - m, x1: x + size + m, y1: y + size + m }
  })
}

/** A rectangle grown by `by` pixels on every side. */
function padded(rect: Point[], by: number): Point[] {
  const unit = (from: Point, to: Point): Point => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1
    return { x: (to.x - from.x) / len, y: (to.y - from.y) / len }
  }
  // Each corner steps back along both of its sides, which moves every side out by `by`.
  return rect.map((p, i) => {
    const next = unit(p, rect[(i + 1) % rect.length])
    const prev = unit(p, rect[(i + rect.length - 1) % rect.length])
    return { x: p.x - (next.x + prev.x) * by, y: p.y - (next.y + prev.y) * by }
  })
}

function perimeter(points: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return sum
}

function bitCount(n: number): number {
  let c = 0
  for (let v = n; v; v &= v - 1) c++
  return c
}
