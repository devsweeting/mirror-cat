import type { Homography } from './surfaceGeometry'

export interface Point {
  x: number
  y: number
}

type Mat3 = [number, number, number, number, number, number, number, number, number]

function toMat(m: Homography): Mat3 {
  return [m.a, m.b, m.c, m.d, m.e, m.f, m.g, m.h, 1]
}

function fromMat(m: Mat3): Homography | null {
  const s = m[8]
  if (!Number.isFinite(s) || Math.abs(s) < 1e-12) return null
  const [a, b, c, d, e, f, g, h] = m.map((v) => v / s)
  const out = { a, b, c, d, e, f, g, h }
  return Object.values(out).every(Number.isFinite) ? out : null
}

function mul(p: Mat3, q: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += p[i * 3 + k] * q[k * 3 + j]
  return r
}

function inv3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) return null
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det
  ]
}

/** Inverse mapping, or null if the homography is degenerate. */
export function invertHomography(m: Homography): Homography | null {
  const inverse = inv3(toMat(m))
  return inverse ? fromMat(inverse) : null
}

/**
 * Hartley normalization: move points to their centroid and scale them so
 * the mean distance is √2. Keeps the least-squares system well conditioned
 * whether points are in pixels (photo) or 0..1 (projector frame).
 */
function normalizer(points: readonly Point[]): Mat3 {
  const n = points.length
  const cx = points.reduce((s, p) => s + p.x, 0) / n
  const cy = points.reduce((s, p) => s + p.y, 0) / n
  const meanDist = points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n || 1
  const k = Math.SQRT2 / meanDist
  return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1]
}

function apply3(m: Mat3, p: Point): Point {
  const w = m[6] * p.x + m[7] * p.y + m[8]
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w }
}

/** Solve an n×n linear system in place (Gaussian elimination, partial pivoting). */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    if (Math.abs(A[pivot][col]) < 1e-12) return null
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    ;[b[col], b[pivot]] = [b[pivot], b[col]]
    for (let r = col + 1; r < n; r++) {
      const factor = A[r][col] / A[col][col]
      for (let c = col; c < n; c++) A[r][c] -= factor * A[col][c]
      b[r] -= factor * b[col]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r]
    for (let c = r + 1; c < n; c++) sum -= A[r][c] * x[c]
    x[r] = sum / A[r][r]
  }
  return x
}

/**
 * Least-squares homography mapping each `from` point onto its `to` point
 * (direct linear transform with Hartley normalization). Needs at least
 * four correspondences, not all on one line; more points average out
 * detection noise. Returns null for a degenerate set.
 */
export function fitHomography(pairs: readonly { from: Point; to: Point }[]): Homography | null {
  if (pairs.length < 4) return null
  const T1 = normalizer(pairs.map((p) => p.from))
  const T2 = normalizer(pairs.map((p) => p.to))
  // Normal equations AᵀA·h = Aᵀb for h = (a..h), with the last entry fixed at 1.
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0))
  const Atb = new Array(8).fill(0)
  const addRow = (row: number[], rhs: number): void => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * rhs
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]
    }
  }
  for (const pair of pairs) {
    const p = apply3(T1, pair.from)
    const q = apply3(T2, pair.to)
    addRow([p.x, p.y, 1, 0, 0, 0, -p.x * q.x, -p.y * q.x], q.x)
    addRow([0, 0, 0, p.x, p.y, 1, -p.x * q.y, -p.y * q.y], q.y)
  }
  const h = solve(AtA, Atb)
  if (!h) return null
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
  const T2inv = inv3(T2)
  return T2inv ? fromMat(mul(T2inv, mul(Hn, T1))) : null
}
