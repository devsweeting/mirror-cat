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

const api = {
  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IpcChannels.GetDisplays),

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
