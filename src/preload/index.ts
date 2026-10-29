import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
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
import type { CaptureEvent, CaptureStartResult, FrameDetection } from '../shared/capture'

const media = {
  list: (): Promise<MediaAsset[]> => ipcRenderer.invoke(IpcChannels.MediaList),

  /** Opens the OS file picker; resolves with nothing imported if cancelled. */
  pickAndImport: (): Promise<MediaImportResult> =>
    ipcRenderer.invoke(IpcChannels.MediaPickAndImport),

  /**
   * Import files dropped from the OS (Finder/Explorer). Paths are resolved
   * here in the preload, never taken from the page: the page can only
   * hand over File objects, and only a real OS drop gives a File a path
   * (one built in JavaScript resolves to "" and is skipped). So page code
   * can't make main read an arbitrary file off disk.
   */
  importFiles: (files: File[]): Promise<MediaImportResult> => {
    const paths = files.map((file) => webUtils.getPathForFile(file)).filter((p) => p.length > 0)
    if (paths.length === 0) return Promise.resolve({ imported: [], errors: [] })
    return ipcRenderer.invoke(IpcChannels.MediaImportPaths, paths)
  },

  importGenerated: (data: GeneratedImageImport): Promise<MediaAsset> =>
    ipcRenderer.invoke(IpcChannels.MediaImportGenerated, data),

  rename: (id: string, name: string): Promise<MediaAsset | null> =>
    ipcRenderer.invoke(IpcChannels.MediaRename, id, name),

  remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IpcChannels.MediaDelete, id),

  attachProbe: (id: string, probe: MediaProbeResult): Promise<MediaAsset | null> =>
    ipcRenderer.invoke(IpcChannels.MediaAttachProbe, id, probe),

  onChanged: (callback: (assets: MediaAsset[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, assets: MediaAsset[]): void =>
      callback(assets)
    ipcRenderer.on(IpcChannels.MediaChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.MediaChanged, listener)
  }
}

/** Surface masks: the renderer makes the PNG, main stores it and returns its id. */
const masks = {
  save: (png: Uint8Array): Promise<string> => ipcRenderer.invoke(IpcChannels.MaskSave, png),

  /** OS file picker for a mask image; null if cancelled. */
  pickImage: (): Promise<{ name: string; bytes: Uint8Array } | null> =>
    ipcRenderer.invoke(IpcChannels.MaskPickImage),

  /** Edit ▸ Edit Mask (⇧⌘M). */
  onToggleEdit: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannels.MaskToggleEdit, listener)
    return () => ipcRenderer.removeListener(IpcChannels.MaskToggleEdit, listener)
  }
}

/** Scan: a QR link the phone uses to send a photo into the library. */
const capture = {
  start: (): Promise<CaptureStartResult> => ipcRenderer.invoke(IpcChannels.CaptureStart),
  stop: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.CaptureStop),
  /** Show or hide the scan pattern on the projector. */
  setPattern: (on: boolean): Promise<boolean> => ipcRenderer.invoke(IpcChannels.CapturePattern, on),
  /** Where the projector frame is in a scan photo (needs the projector open). */
  detectFrame: (assetId: string): Promise<FrameDetection> =>
    ipcRenderer.invoke(IpcChannels.CaptureDetectFrame, assetId),
  /** Projector window: draw the scan pattern or not. */
  onPattern: (callback: (on: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, on: boolean): void => callback(on)
    ipcRenderer.on(IpcChannels.CapturePatternShow, listener)
    return () => ipcRenderer.removeListener(IpcChannels.CapturePatternShow, listener)
  },
  onEvent: (callback: (event: CaptureEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CaptureEvent): void =>
      callback(payload)
    ipcRenderer.on(IpcChannels.CaptureEvent, listener)
    return () => ipcRenderer.removeListener(IpcChannels.CaptureEvent, listener)
  }
}

/**
 * Settings › AI & animation. A key goes in through setKey and never comes
 * back out: every reply is a status (last four characters, checked or not).
 */
const ai = {
  getState: (): Promise<AiState> => ipcRenderer.invoke(IpcChannels.AiGetState),
  setKey: (id: AiProviderId, key: string): Promise<SetKeyResult> =>
    ipcRenderer.invoke(IpcChannels.AiSetKey, id, key),
  removeKey: (id: AiProviderId): Promise<AiProviderStatus> =>
    ipcRenderer.invoke(IpcChannels.AiRemoveKey, id),
  updateSettings: (patch: Partial<AnimationSettings>): Promise<AnimationSettings> =>
    ipcRenderer.invoke(IpcChannels.AiUpdateSettings, patch)
}

const api = {
  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IpcChannels.GetDisplays),

  /** A display was plugged in, removed or resized; receives the new list. */
  onDisplaysChanged: (callback: (displays: DisplayInfo[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, displays: DisplayInfo[]): void =>
      callback(displays)
    ipcRenderer.on(IpcChannels.DisplaysChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.DisplaysChanged, listener)
  },

  openOutputWindow: (displayId: number): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.OpenOutputWindow, displayId),

  closeOutputWindow: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.CloseOutputWindow),

  /** The projector window closed by any route (Esc, Stop, display unplugged). */
  onOutputClosed: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannels.OutputClosed, listener)
    return () => ipcRenderer.removeListener(IpcChannels.OutputClosed, listener)
  },

  sendSceneUpdate: (scene: SceneState): void => {
    ipcRenderer.send(IpcChannels.SceneUpdate, scene)
  },

  onSceneUpdate: (callback: (scene: SceneState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, scene: SceneState): void => callback(scene)
    ipcRenderer.on(IpcChannels.SceneUpdate, listener)
    return () => ipcRenderer.removeListener(IpcChannels.SceneUpdate, listener)
  },

  requestSceneSync: (): Promise<SceneState | null> =>
    ipcRenderer.invoke(IpcChannels.SceneRequestSync),

  loadSavedScene: (): Promise<Surface[] | null> => ipcRenderer.invoke(IpcChannels.SceneLoadSaved),

  /** Edit ▸ Undo / Redo from the app menu (including ⌘Z / ⇧⌘Z). */
  onEditCommand: (callback: (command: EditCommand) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: EditCommand): void =>
      callback(command)
    ipcRenderer.on(IpcChannels.EditCommand, listener)
    return () => ipcRenderer.removeListener(IpcChannels.EditCommand, listener)
  },

  /** App menu ▸ Settings (⌘,). */
  onOpenSettings: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannels.SettingsOpen, listener)
    return () => ipcRenderer.removeListener(IpcChannels.SettingsOpen, listener)
  },

  media,
  masks,
  capture,
  ai
}

// Both windows run with contextIsolation and sandbox on, so the API only
// ever reaches the page through the bridge. There is deliberately no
// fallback that puts it on `window` directly.
contextBridge.exposeInMainWorld('mirrorcat', api)
