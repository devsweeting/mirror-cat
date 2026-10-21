import type { SceneState, Surface } from '../../shared/types'
import { normalizeSurface } from '../persistence/sceneAutosave'

/** Far more than any wall needs; bounds the work one update can cause. */
export const MAX_SURFACES = 64

/**
 * Validate a scene arriving over IPC before main relays it to the
 * projector or autosaves it. Same rules as loading scene.json, except the
 * play token is kept (it's how "restart video" reaches the projector).
 *
 * All or nothing: if any surface is malformed the whole update is
 * rejected, rather than autosaving a scene with surfaces silently missing.
 */
export function normalizeScene(value: unknown): SceneState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Record<keyof SceneState, unknown>>
  if (!Array.isArray(raw.surfaces) || raw.surfaces.length > MAX_SURFACES) return null

  const surfaces: Surface[] = []
  for (const item of raw.surfaces) {
    const surface = normalizeSurface(item)
    if (!surface) return null
    const token = (item as Partial<Surface>).playToken
    surface.playToken =
      Number.isSafeInteger(token) && (token as number) >= 0 ? (token as number) : 0
    surfaces.push(surface)
  }

  const display = raw.outputDisplayId
  const outputDisplayId =
    typeof display === 'number' && Number.isSafeInteger(display) ? display : null
  return { surfaces, outputDisplayId }
}
