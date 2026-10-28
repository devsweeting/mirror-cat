import { useEffect, type RefObject } from 'react'
import * as THREE from 'three'
import { DEFAULT_MASK_PARAMS, type SurfaceMask } from '@shared/mask'
import type { ProjectionEngine } from '../engine/ProjectionEngine'
import { configureMaskTexture, fieldTexture, loadMaskField } from '../masks/maskImage'
import { paintCanvas, useMaskPaint } from '../state/maskPaint'

interface SurfaceMaskOptions {
  surfaceId: string
  mask: SurfaceMask | null
  /** False for the editor's handles-only overlay, which draws no content. */
  enabled: boolean
}

/**
 * Keeps a surface's mask on its ProjectionEngine: the saved mask (as a
 * distance field) normally, or the live paint canvas while this surface is
 * being painted in this window. The projector window never has a paint
 * session, so it always shows the saved mask -- updated after each stroke.
 */
export function useSurfaceMask(
  engineRef: RefObject<ProjectionEngine | null>,
  { surfaceId, mask, enabled }: SurfaceMaskOptions
): void {
  const live = useMaskPaint((s) => enabled && s.surfaceId === surfaceId)
  const version = useMaskPaint((s) => (s.surfaceId === surfaceId ? s.version : 0))
  const maskId = mask?.id ?? null

  // Which texture: live canvas, saved field, or none.
  useEffect(() => {
    if (!enabled) return
    if (live) {
      const source = paintCanvas()
      if (!source) return
      const texture = new THREE.CanvasTexture(source)
      configureMaskTexture(texture)
      engineRef.current?.setMaskTexture(texture)
      return
    }
    if (!maskId) {
      engineRef.current?.setMaskTexture(null)
      return
    }
    // Keep whatever is showing until the new field is ready, so finishing a
    // paint session (live canvas → saved mask) doesn't flash unmasked.
    let cancelled = false
    loadMaskField(maskId).then(
      (field) => {
        if (!cancelled) engineRef.current?.setMaskTexture(fieldTexture(field))
      },
      (error: unknown) => {
        if (cancelled) return
        // Missing or unreadable: show the surface unmasked rather than
        // keeping a stale shape; say why in the console.
        console.warn('[masks] could not load mask', maskId, error)
        engineRef.current?.setMaskTexture(null)
      }
    )
    return () => {
      cancelled = true
    }
  }, [enabled, live, maskId, engineRef])

  // Live canvas changed: re-upload it.
  useEffect(() => {
    if (live && version > 0) engineRef.current?.maskTextureChanged()
  }, [live, version, engineRef])

  const invert = mask?.invert ?? DEFAULT_MASK_PARAMS.invert
  const grow = mask?.grow ?? DEFAULT_MASK_PARAMS.grow
  const feather = mask?.feather ?? DEFAULT_MASK_PARAMS.feather
  useEffect(() => {
    if (!enabled) return
    engineRef.current?.setMaskParams({ invert, grow, feather })
  }, [enabled, invert, grow, feather, engineRef])
}
