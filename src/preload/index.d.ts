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
  /** Files from an OS drag-and-drop; paths are resolved inside the preload. */
  importFiles(files: File[]): Promise<MediaImportResult>
  importGenerated(data: GeneratedImageImport): Promise<MediaAsset>
  rename(id: string, name: string): Promise<MediaAsset | null>
  remove(id: string): Promise<boolean>
  attachProbe(id: string, probe: MediaProbeResult): Promise<MediaAsset | null>
  onChanged(callback: (assets: MediaAsset[]) => void): () => void
}

export interface MirrorCatApi {
  getDisplays(): Promise<DisplayInfo[]>
  onDisplaysChanged(callback: (displays: DisplayInfo[]) => void): () => void
  openOutputWindow(displayId: number): Promise<boolean>
  closeOutputWindow(): Promise<boolean>
  onOutputClosed(callback: () => void): () => void
  sendSceneUpdate(scene: SceneState): void
  onSceneUpdate(callback: (scene: SceneState) => void): () => void
  requestSceneSync(): Promise<SceneState | null>
  loadSavedScene(): Promise<Surface[] | null>
  onEditCommand(callback: (command: EditCommand) => void): () => void
  media: MirrorCatMediaApi
}

declare global {
  interface Window {
    mirrorcat: MirrorCatApi
  }
}

export {}
