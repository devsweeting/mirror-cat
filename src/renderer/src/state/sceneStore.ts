import { create } from 'zustand'
import type { GeneratedContent, SceneState, Surface } from '@shared/types'
import { createSurface } from '@shared/types'

interface SceneStore extends SceneState {
  addSurface: (name: string) => string
  updateCorners: (surfaceId: string, corners: Surface['corners']) => void
  setSurfaceContent: (surfaceId: string, content: GeneratedContent) => void
  removeSurface: (surfaceId: string) => void
  setOutputDisplayId: (id: number | null) => void
}

let nextId = 1

export const useSceneStore = create<SceneStore>((set) => ({
  surfaces: [createSurface('surface-1', 'Surface 1')],
  content: {},
  outputDisplayId: null,

  addSurface: (name) => {
    const id = `surface-${++nextId}`
    set((state) => ({ surfaces: [...state.surfaces, createSurface(id, name)] }))
    return id
  },

  updateCorners: (surfaceId, corners) => {
    set((state) => ({
      surfaces: state.surfaces.map((s) => (s.id === surfaceId ? { ...s, corners } : s))
    }))
  },

  setSurfaceContent: (surfaceId, content) => {
    set((state) => ({
      content: { ...state.content, [content.id]: content },
      surfaces: state.surfaces.map((s) => (s.id === surfaceId ? { ...s, contentId: content.id } : s))
    }))
  },

  removeSurface: (surfaceId) => {
    set((state) => {
      const removed = state.surfaces.find((s) => s.id === surfaceId)
      const surfaces = state.surfaces.filter((s) => s.id !== surfaceId)
      if (!removed?.contentId) return { surfaces }
      const { [removed.contentId]: _discarded, ...content } = state.content
      return { surfaces, content }
    })
  },

  setOutputDisplayId: (id) => set({ outputDisplayId: id })
}))
