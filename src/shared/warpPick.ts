/**
 * Subdivisions of the warp mesh, shared by the renderer and by anything
 * that needs to map a point on screen back into a surface's content space
 * (mask painting). Both must use the same grid or a brush stroke would land
 * slightly off from where it's drawn.
 */
export const WARP_SEGMENTS = 48

/** Where a screen point falls in a surface's content, and how content stretches there. */
export interface WarpPick {
  /** Content position: u across 0..1, v down 0..1 (may be outside for points off the surface). */
  u: number
  v: number
  /**
   * Local screen derivatives: moving +1 in u moves (du.x, du.y) pixels on
   * screen, +1 in v moves (dv.x, dv.y). Used to turn a round brush on screen
   * into the right ellipse in content space.
   */
  du: { x: number; y: number }
  dv: { x: number; y: number }
  /** True when the point is on the surface itself, not extrapolated from its nearest edge. */
  inside: boolean
}

/**
 * Inverts the warp numerically: finds the mesh triangle under (x, y) and
 * reads the content position from its barycentric coordinates. This works
 * for every warp mode (perspective, even, edge nodes) because it inverts
 * the mesh that is actually drawn rather than the formula behind it.
 *
 * `positions` is the (segments+1)² × 3 array written by writeWarpGrid, in
 * pixels; row j of the grid is v = j / segments from the top edge down.
 * Triangles match the mesh's index order. Points off the surface are
 * extrapolated from the closest triangle, so a brush that overlaps the edge
 * still paints the part that's on it. Returns null only for a degenerate
 * (zero-area) mesh.
 */
export function pickWarpGrid(
  positions: ArrayLike<number>,
  segments: number,
  x: number,
  y: number
): WarpPick | null {
  const rows = segments + 1
  let best: WarpPick | null = null
  let bestScore = -Infinity

  const px = (r: number, c: number): number => positions[(r * rows + c) * 3]
  const py = (r: number, c: number): number => positions[(r * rows + c) * 3 + 1]

  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      // Two triangles per cell, as in the mesh: (a, c, b) and (b, c, d) with
      // a = (j, i), b = (j, i+1), c = (j+1, i), d = (j+1, i+1).
      for (let t = 0; t < 2; t++) {
        const r0 = j
        const c0 = t === 0 ? i : i + 1
        const r1 = j + 1
        const c1 = i
        const r2 = t === 0 ? j : j + 1
        const c2 = i + 1
        const x0 = px(r0, c0)
        const y0 = py(r0, c0)
        const ex1 = px(r1, c1) - x0
        const ey1 = py(r1, c1) - y0
        const ex2 = px(r2, c2) - x0
        const ey2 = py(r2, c2) - y0
        const det = ex1 * ey2 - ex2 * ey1
        if (Math.abs(det) < 1e-9) continue
        const qx = x - x0
        const qy = y - y0
        const l1 = (qx * ey2 - ex2 * qy) / det
        const l2 = (ex1 * qy - qx * ey1) / det
        const l0 = 1 - l1 - l2
        const score = Math.min(l0, l1, l2)
        // Inside triangles score ≥ 0; only a closer candidate can win, so
        // the first containing triangle is usually final.
        if (score <= bestScore) continue
        bestScore = score

        // Content coordinates of the three vertices.
        const u0 = c0 / segments
        const v0 = r0 / segments
        const su1 = c1 / segments - u0
        const sv1 = r1 / segments - v0
        const su2 = c2 / segments - u0
        const sv2 = r2 / segments - v0
        const u = u0 + l1 * su1 + l2 * su2
        const v = v0 + l1 * sv1 + l2 * sv2

        // Screen = J · content within this triangle: [e1 e2] = J · [s1 s2].
        const sdet = su1 * sv2 - su2 * sv1
        const inv = [sv2 / sdet, -su2 / sdet, -sv1 / sdet, su1 / sdet]
        best = {
          u,
          v,
          du: { x: ex1 * inv[0] + ex2 * inv[2], y: ey1 * inv[0] + ey2 * inv[2] },
          dv: { x: ex1 * inv[1] + ex2 * inv[3], y: ey1 * inv[1] + ey2 * inv[3] },
          inside: score >= -1e-9
        }
        if (best.inside) return best
      }
    }
  }
  return best
}
