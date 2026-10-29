import type { DisplayInfo, EditCommand, SceneState, Surface } from '../shared/types'
import type {
  GeneratedImageImport,
  MediaAsset,
  MediaImportResult,
  MediaProbeResult
} from '../shared/media'
import type {
  AiProviderId,
  AiProviderStatus,
  AiState,
  AnimationSettings,
  SetKeyResult
} from '../shared/ai'
import type { CaptureEvent, CaptureStartResult } from '../shared/capture'

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

export interface MirrorCatMasksApi {
  /** Store a mask PNG (made in the renderer); resolves with its id. */
  save(png: Uint8Array): Promise<string>
  /** OS file picker for a mask image; resolves null if cancelled. */
  pickImage(): Promise<{ name: string; bytes: Uint8Array } | null>
  /** Edit ▸ Edit Mask (⇧⌘M) was chosen. */
  onToggleEdit(callback: () => void): () => void
}

export interface MirrorCatCaptureApi {
  /** Open a scan link; resolves with its QR code, or why it couldn't. */
  start(): Promise<CaptureStartResult>
  stop(): Promise<boolean>
  onEvent(callback: (event: CaptureEvent) => void): () => void
}

export interface MirrorCatAiApi {
  getState(): Promise<AiState>
  /** Checks the key with the provider, then stores it encrypted in main. */
  setKey(id: AiProviderId, key: string): Promise<SetKeyResult>
  removeKey(id: AiProviderId): Promise<AiProviderStatus>
  updateSettings(patch: Partial<AnimationSettings>): Promise<AnimationSettings>
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
  onOpenSettings(callback: () => void): () => void
  media: MirrorCatMediaApi
  masks: MirrorCatMasksApi
  capture: MirrorCatCaptureApi
  ai: MirrorCatAiApi
}

declare global {
  interface Window {
    mirrorcat: MirrorCatApi
  }
}

export {}
