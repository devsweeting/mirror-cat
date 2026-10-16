import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import type { DisplayInfo, EditCommand, SceneState, Surface } from '../shared/types'
import type {
  GeneratedImageImport,
  MediaAsset,
  MediaImportResult,
  MediaProbeResult
} from '../shared/media'

const media = {
  list: (): Promise<MediaAsset[]> => ipcRenderer.invoke(IpcChannels.MediaList),

  /** Opens the OS file picker; resolves with nothing imported if cancelled. */
  pickAndImport: (): Promise<MediaImportResult> =>
    ipcRenderer.invoke(IpcChannels.MediaPickAndImport),

  importPaths: (paths: string[]): Promise<MediaImportResult> =>
    ipcRenderer.invoke(IpcChannels.MediaImportPaths, paths),

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

const api = {
  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IpcChannels.GetDisplays),

  openOutputWindow: (displayId: number): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.OpenOutputWindow, displayId),

  closeOutputWindow: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.CloseOutputWindow),

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

  /**
   * Real filesystem path of a dropped File (File.path was removed from
   * Electron). Empty string for files that don't exist on disk.
   */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  media
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('mirrorcat', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error -- fallback only used if contextIsolation is ever disabled
  window.mirrorcat = api
}
