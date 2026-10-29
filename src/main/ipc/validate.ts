import type { FrameBox } from '../../shared/sam'
import type { CornerSet } from '../../shared/types'
import { ASSET_ID_PATTERN } from '../../shared/media'

/** Four finite corners within a sane range (an image can sit well past the frame). */
export function parseCorners(value: unknown): CornerSet | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const ok = value.every(
    (c) =>
      c &&
      typeof c === 'object' &&
      Number.isFinite((c as { x: number }).x) &&
      Number.isFinite((c as { y: number }).y) &&
      Math.abs((c as { x: number }).x) < 100 &&
      Math.abs((c as { y: number }).y) < 100
  )
  return ok ? (value.map((c) => ({ x: c.x, y: c.y })) as CornerSet) : null
}

/** A box inside the frame (clamped) with some size to it, or null. */
export function parseBox(value: unknown): FrameBox | null {
  const b = value as Partial<FrameBox> | null
  if (!b || typeof b !== 'object') return null
  const v = [b.x0, b.y0, b.x1, b.y1]
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const clamp = (n: number): number => Math.min(1, Math.max(0, n))
  const box = { x0: clamp(b.x0!), y0: clamp(b.y0!), x1: clamp(b.x1!), y1: clamp(b.y1!) }
  return box.x1 - box.x0 > 0.01 && box.y1 - box.y0 > 0.01 ? box : null
}

/** Up to `max` distinct shape ids ("shape-12"). */
export function parseShapeIds(value: unknown, max = 32): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return null
  if (!value.every((v) => typeof v === 'string' && /^shape-\d{1,4}$/.test(v))) return null
  return [...new Set(value as string[])]
}

export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID_PATTERN.test(value)
}
