/**
 * Plain-array helpers around SAM 2: what goes into the model and how its
 * answers become masks at the shape finder's size. No onnxruntime here, so
 * it's all unit-testable.
 */

/** The model's input side; photos are squashed (not padded) to this. */
export const SAM_SIZE = 1024
/** The side of the low-resolution mask logits it answers with. */
export const SAM_MASK_SIZE = 256

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

/**
 * A SAM_SIZE² BGRA bitmap (as Electron's nativeImage gives it) as the
 * model's input: RGB planes, scaled to 0..1, ImageNet-normalized.
 */
export function preprocessBgra(bgra: Uint8Array): Float32Array {
  const n = SAM_SIZE * SAM_SIZE
  if (bgra.length < n * 4) throw new Error('Expected a 1024×1024 bitmap')
  const out = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    out[i] = (bgra[o + 2] / 255 - MEAN[0]) / STD[0]
    out[n + i] = (bgra[o + 1] / 255 - MEAN[1]) / STD[1]
    out[2 * n + i] = (bgra[o] / 255 - MEAN[2]) / STD[2]
  }
  return out
}

/**
 * One mask's 256² logits (mask `index` of a stack) as a 0/1 mask of
 * `width`×`height`, sampling the logits smoothly so edges aren't blocky.
 * `offset` moves the cut-off (positive = stricter), for stability checks.
 */
export function logitsToMask(
  logits: Float32Array,
  index: number,
  width: number,
  height: number,
  offset = 0
): Uint8Array {
  const s = SAM_MASK_SIZE
  const base = index * s * s
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const fy = Math.min(s - 1, Math.max(0, ((y + 0.5) / height) * s - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(s - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(s - 1, Math.max(0, ((x + 0.5) / width) * s - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(s - 1, x0 + 1)
      const tx = fx - x0
      const v =
        (logits[base + y0 * s + x0] * (1 - tx) + logits[base + y0 * s + x1] * tx) * (1 - ty) +
        (logits[base + y1 * s + x0] * (1 - tx) + logits[base + y1 * s + x1] * tx) * ty
      out[y * width + x] = v > offset ? 1 : 0
    }
  }
  return out
}

/**
 * SAM's stability score: how much of the mask survives moving the cut-off
 * by ±1. A crisp object scores near 1; a vague smear scores low.
 */
export function stabilityScore(logits: Float32Array, index: number): number {
  const s = SAM_MASK_SIZE
  const base = index * s * s
  let strict = 0
  let loose = 0
  for (let i = 0; i < s * s; i++) {
    const v = logits[base + i]
    if (v > 1) strict++
    if (v > -1) loose++
  }
  return loose === 0 ? 0 : strict / loose
}

/**
 * Points for "find everything", in SAM_SIZE input coordinates: a grid
 * across the frame with about `across` columns, rows to match its shape,
 * each point in the middle of its cell.
 */
export function gridPoints(frameWidth: number, frameHeight: number, across = 10): [number, number][] {
  const rows = Math.max(2, Math.round((across * frameHeight) / frameWidth))
  const points: [number, number][] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < across; c++) {
      points.push([((c + 0.5) / across) * SAM_SIZE, ((r + 0.5) / rows) * SAM_SIZE])
    }
  }
  return points
}
