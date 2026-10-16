import type { DisplayInfo, EditCommand, SceneState, Surface } from '../shared/types'
import type {
  GeneratedImageImport,
  MediaAsset,
  MediaImportResult,
  MediaProbeResult
} from '../shared/media'

export interface MirrorCatMediaApi {
  list(): Promise<MediaAsset[]>
  pickAndImport(): Promise<MediaImportResult>
  importPaths(paths: string[]): Promise<MediaImportResult>
  importGenerated(data: GeneratedImageImport): Promise<MediaAsset>
  rename(id: string, name: string): Promise<MediaAsset | null>
  remove(id: string): Promise<boolean>
  attachProbe(id: string, probe: MediaProbeResult): Promise<MediaAsset | null>
  onChanged(callback: (assets: MediaAsset[]) => void): () => void
}

export interface MirrorCatApi {
  getDisplays(): Promise<DisplayInfo[]>
  openOutputWindow(displayId: number): Promise<boolean>
  closeOutputWindow(): Promise<boolean>
  sendSceneUpdate(scene: SceneState): void
  onSceneUpdate(callback: (scene: SceneState) => void): () => void
  requestSceneSync(): Promise<SceneState | null>
  loadSavedScene(): Promise<Surface[] | null>
  onEditCommand(callback: (command: EditCommand) => void): () => void
  getPathForFile(file: File): string
  media: MirrorCatMediaApi
}

declare global {
  interface Window {
    mirrorcat: MirrorCatApi
  }
}

export {}
