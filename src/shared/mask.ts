import { ASSET_ID_PATTERN, MEDIA_SCHEME } from './media'

/**
 * A surface mask: a grayscale image laid over the surface in its own
 * content space (u across, v down), white = lit, black = dark. Because it
 * lives in the surface's UV space it moves, bends and foreshortens with the
 * surface -- nudging a corner after masking keeps the cut-out on the object.
 *
 * Grow and feather don't touch the image. Each mask is turned into a signed
 * distance field when it loads, so both are just shader uniforms and the
 * sliders are instant. Units are a fraction of the mask's shorter side.
 * See docs/surfaces-and-warping.md → "Masks".
 */
export interface SurfaceMask {
  /** sha256 of the mask PNG in `userData/masks`. */
  id: string
  /** Swap lit and dark. */
  invert: boolean
  /** Push the edge out (+) or pull it in (−), fraction of the shorter side. */
  grow: number
  /** Width of the soft edge, fraction of the shorter side. 0 = crisp. */
  feather: number
}

export const MAX_MASK_GROW = 0.05
export const MAX_MASK_FEATHER = 0.1
/**
 * Distance the field encodes either side of the edge, in the same units.
 * Must cover the furthest a slider can reach: grow + half the feather.
 */
export const MASK_FIELD_RANGE = MAX_MASK_GROW + MAX_MASK_FEATHER / 2 + 0.02
/** Longest side the distance field is computed at. Plenty for a wall. */
export const MASK_FIELD_MAX_EDGE = 1024
/** Longest side a stored mask image may have. */
export const MAX_MASK_EDGE = 4096
export const MAX_MASK_BYTES = 32 * 1024 * 1024
/** Longest side of a mask painted from scratch, and of uploaded masks. */
export const MASK_PAINT_EDGE = 1024
export const MASK_UPLOAD_EDGE = 2048

export const DEFAULT_MASK_PARAMS: Omit<SurfaceMask, 'id'> = {
  invert: false,
  grow: 0,
  feather: 0.01
}

export function maskUrl(id: string): string {
  return `${MEDIA_SCHEME}://mask/${id}`
}

/** Defensive read of a saved or synced mask. Anything malformed means "no mask". */
export function normalizeMask(value: unknown): SurfaceMask | null {
  if (!value || typeof value !== 'object') return null
  const m = value as Partial<SurfaceMask>
  if (typeof m.id !== 'string' || !ASSET_ID_PATTERN.test(m.id)) return null
  return {
    id: m.id,
    invert: m.invert === true,
    grow: clampNumber(m.grow, -MAX_MASK_GROW, MAX_MASK_GROW, DEFAULT_MASK_PARAMS.grow),
    feather: clampNumber(m.feather, 0, MAX_MASK_FEATHER, DEFAULT_MASK_PARAMS.feather)
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/**
 * One gray value per pixel from RGBA, for turning any image into a mask.
 * Images with transparency use their alpha (a cut-out PNG, e.g. a photo
 * with the background removed); fully opaque ones use luminance (paint
 * white where light should go). Mostly-opaque images count as opaque, so a
 * stray translucent pixel in a JPEG-like PNG doesn't flip the meaning.
 */
export function maskGrayFromRgba(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const count = rgba.length >> 2
  const gray = new Uint8Array(count)
  let transparent = 0
  for (let i = 0; i < count; i++) if (rgba[i * 4 + 3] < 250) transparent++
  const useAlpha = transparent > count * 0.001
  for (let i = 0; i < count; i++) {
    const o = i * 4
    gray[i] = useAlpha
      ? rgba[o + 3]
      : Math.round(0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2])
  }
  return gray
}

/** Working size for the distance field: same aspect, longest side ≤ max. */
export function fieldSize(width: number, height: number, max = MASK_FIELD_MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

const INF = 1e20

/**
 * Squared distance transform of one row/column (Felzenszwalb & Huttenlocher
 * 2012): f holds 0 at feature pixels and INF elsewhere; d receives the
 * squared distance to the nearest feature. Linear time.
 */
function edt1d(
  f: Float64Array,
  n: number,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array
): void {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dq = q - v[k]
    d[q] = dq * dq + f[v[k]]
  }
}

/** Squared distance from every pixel to the nearest pixel where `isFeature`. */
function squaredDistances(inside: Uint8Array, w: number, h: number, feature: 0 | 1): Float64Array {
  const grid = new Float64Array(w * h)
  for (let i = 0; i < grid.length; i++) grid[i] = inside[i] === feature ? 0 : INF
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) f[x] = grid[row + x]
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[row + x] = d[x]
  }
  return grid
}

/**
 * Signed distance field of a grayscale mask (≥ 128 = lit), encoded one byte
 * per pixel: 128 on the edge, above inside, below outside, saturating at
 * ±MASK_FIELD_RANGE (fraction of the shorter side). The shader decodes it
 * and applies grow / feather / invert. A plain black-and-white image is a
 * valid (if crude) field in this encoding too -- the edge still crosses
 * 128 -- which is what the live preview uses while painting.
 */
export function encodeSignedDistanceField(gray: Uint8Array, w: number, h: number): Uint8Array {
  const inside = new Uint8Array(w * h)
  for (let i = 0; i < inside.length; i++) inside[i] = gray[i] >= 128 ? 1 : 0
  const toOutside = squaredDistances(inside, w, h, 0)
  const toInside = squaredDistances(inside, w, h, 1)
  const unit = Math.min(w, h)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) {
    // Pixel centers are half a pixel from the edge between them.
    const px = inside[i] ? Math.sqrt(toOutside[i]) - 0.5 : 0.5 - Math.sqrt(toInside[i])
    const norm = px / unit / MASK_FIELD_RANGE
    out[i] = Math.round(Math.min(1, Math.max(0, 0.5 + norm / 2)) * 255)
  }
  return out
}

/** Decode one encoded byte back to a signed distance (fraction of the shorter side). */
export function decodeFieldValue(byte: number): number {
  return (byte / 255 - 0.5) * 2 * MASK_FIELD_RANGE
}
