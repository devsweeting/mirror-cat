import type { DisplayInfo, SceneState } from '../shared/types'

export interface MirrorCatApi {
  getDisplays(): Promise<DisplayInfo[]>
  openOutputWindow(displayId: number): Promise<boolean>
  closeOutputWindow(): Promise<boolean>
  sendSceneUpdate(scene: SceneState): void
  onSceneUpdate(callback: (scene: SceneState) => void): () => void
  requestSceneSync(): Promise<SceneState | null>
}

declare global {
  interface Window {
    mirrorcat: MirrorCatApi
  }
}

export {}
