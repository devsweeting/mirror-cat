import type { CornerSet, DisplayInfo, EditCommand, SceneState, Surface } from '../shared/types'
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
import type { CaptureEvent, CaptureStartResult, FrameDetection } from '../shared/capture'
import type { DetectedShape } from '../shared/shapes'

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
  /** Show or hide the scan pattern on the projector. */
  setPattern(on: boolean): Promise<boolean>
  /** Where the projector frame is in a scan photo (needs the projector open). */
  detectFrame(assetId: string): Promise<FrameDetection>
  /** Straighten the part of an image inside `corners` into a frame-shaped library image. */
  rectify(
    assetId: string,
    corners: CornerSet,
    frame?: { width: number; height: number }
  ): Promise<MediaAsset>
  /** Flat shapes in a fitted scan image (0..1 of the frame). */
  findShapes(assetId: string): Promise<DetectedShape[]>
  /** Mask id for a found shape on a surface with these corners, or null. */
  shapeMask(assetId: string, shapeId: string, corners: CornerSet): Promise<string | null>
  /** Projector window: draw the scan pattern or not. */
  onPattern(callback: (on: boolean) => void): () => void
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
  onOutputDisplayChanged(callback: (displayId: number) => void): () => void
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
