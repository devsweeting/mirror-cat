import { create } from 'zustand'
import type { EdgeNodeSet, SceneState, Surface, SurfaceSettings } from '@shared/types'
import { createSurface, nextSurfaceColor } from '@shared/types'
import type { SurfaceMask } from '@shared/mask'

interface SceneStore extends SceneState {
  /** Replace surfaces with ones loaded from the autosave (launch only). */
  hydrate: (surfaces: Surface[]) => void
  addSurface: (name: string) => string
  updateCorners: (surfaceId: string, corners: Surface['corners']) => void
  updateEdgeNodes: (surfaceId: string, edgeNodes: EdgeNodeSet) => void
  /** Put a library asset on a surface, or clear it with null. */
  setSurfaceAsset: (surfaceId: string, assetId: string | null) => void
  /** Clear an asset from every surface showing it (before deleting it from the library). */
  clearAssetEverywhere: (assetId: string) => void
  updateSurfaceSettings: (surfaceId: string, patch: Partial<SurfaceSettings>) => void
  /** Set or clear a surface's mask. */
  setSurfaceMask: (surfaceId: string, mask: SurfaceMask | null) => void
  /** Change invert / grow / feather of an existing mask. */
  updateSurfaceMask: (surfaceId: string, patch: Partial<Omit<SurfaceMask, 'id'>>) => void
  /** Restart a surface's video from the top, in the editor and on the projector. */
  replaySurface: (surfaceId: string) => void
  renameSurface: (surfaceId: string, name: string) => void
  removeSurface: (surfaceId: string) => void
  /**
   * Restack: put a surface directly in front of ('above') or behind
   * ('below') another one. The surfaces array is back-to-front, i.e. later
   * entries are drawn on top on the projector.
   */
  moveSurface: (surfaceId: string, targetId: string, placement: 'above' | 'below') => void
  /** Swap with the neighbour one step toward the front (+1) or back (-1). */
  stepSurface: (surfaceId: string, direction: 1 | -1) => void
  setOutputDisplayId: (id: number | null) => void
}

/**
 * Random rather than a counter: ids are persisted now, and a counter
 * restarting at 1 after a relaunch would collide with saved surfaces.
 */
function newSurfaceId(): string {
  return `surface-${crypto.randomUUID().slice(0, 8)}`
}

export const useSceneStore = create<SceneStore>((set) => ({
  surfaces: [createSurface('surface-1', 'Surface 1')],
  outputDisplayId: null,

  hydrate: (surfaces) => set({ surfaces }),

  addSurface: (name) => {
    const id = newSurfaceId()
    set((state) => {
      const color = nextSurfaceColor(state.surfaces.map((s) => s.outlineColor))
      return { surfaces: [...state.surfaces, createSurface(id, name, color)] }
    })
    return id
  },

  updateCorners: (surfaceId, corners) => {
    set((state) => ({
      surfaces: state.surfaces.map((s) => (s.id === surfaceId ? { ...s, corners } : s))
    }))
  },

  updateEdgeNodes: (surfaceId, edgeNodes) => {
    set((state) => ({
      surfaces: state.surfaces.map((s) => (s.id === surfaceId ? { ...s, edgeNodes } : s))
    }))
  },

  setSurfaceAsset: (surfaceId, assetId) => {
    set((state) => ({
      surfaces: state.surfaces.map((s) => (s.id === surfaceId ? { ...s, assetId } : s))
    }))
  },

  clearAssetEverywhere: (assetId) => {
    set((state) => ({
      surfaces: state.surfaces.map((s) => (s.assetId === assetId ? { ...s, assetId: null } : s))
    }))
  },

  updateSurfaceSettings: (surfaceId, patch) => {
    set((state) => ({
      surfaces: state.surfaces.map((s) => (s.id === surfaceId ? { ...s, ...patch } : s))
    }))
  },

  setSurfaceMask: (surfaceId, mask) => {
    set((state) => ({
      surfaces: state.surfaces.map((s) => (s.id === surfaceId ? { ...s, mask } : s))
    }))
  },

  updateSurfaceMask: (surfaceId, patch) => {
    set((state) => ({
      surfaces: state.surfaces.map((s) =>
        s.id === surfaceId && s.mask ? { ...s, mask: { ...s.mask, ...patch } } : s
      )
    }))
  },

  replaySurface: (surfaceId) => {
    set((state) => ({
      surfaces: state.surfaces.map((s) =>
        s.id === surfaceId ? { ...s, playToken: s.playToken + 1 } : s
      )
    }))
  },

  renameSurface: (surfaceId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((state) => ({
      surfaces: state.surfaces.map((s) => (s.id === surfaceId ? { ...s, name: trimmed } : s))
    }))
  },

  // The surface's image stays in the media library -- only the surface goes.
  removeSurface: (surfaceId) => {
    set((state) => ({ surfaces: state.surfaces.filter((s) => s.id !== surfaceId) }))
  },

  moveSurface: (surfaceId, targetId, placement) => {
    if (surfaceId === targetId) return
    set((state) => {
      const moving = state.surfaces.find((s) => s.id === surfaceId)
      if (!moving) return {}
      const rest = state.surfaces.filter((s) => s.id !== surfaceId)
      const targetIndex = rest.findIndex((s) => s.id === targetId)
      if (targetIndex === -1) return {}
      rest.splice(placement === 'above' ? targetIndex + 1 : targetIndex, 0, moving)
      // No-op moves (dropped back where it was) shouldn't sync or autosave.
      return rest.every((s, i) => s === state.surfaces[i]) ? {} : { surfaces: rest }
    })
  },

  stepSurface: (surfaceId, direction) => {
    set((state) => {
      const index = state.surfaces.findIndex((s) => s.id === surfaceId)
      const swapWith = index + direction
      if (index === -1 || swapWith < 0 || swapWith >= state.surfaces.length) return {}
      const surfaces = [...state.surfaces]
      ;[surfaces[index], surfaces[swapWith]] = [surfaces[swapWith], surfaces[index]]
      return { surfaces }
    })
  },

  setOutputDisplayId: (id) => set({ outputDisplayId: id })
}))
