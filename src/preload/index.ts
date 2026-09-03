import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import type { DisplayInfo, SceneState } from '../shared/types'

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

  requestSceneSync: (): Promise<SceneState | null> => ipcRenderer.invoke(IpcChannels.SceneRequestSync)
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
