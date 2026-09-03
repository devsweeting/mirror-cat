import { ipcMain, screen } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import type { SceneState } from '../../shared/types'
import { listDisplays } from '../displays'
import { openOutputWindow, closeOutputWindow, getOutputWindow } from '../windows/outputWindow'

// Last scene received from the control window, replayed to the output
// window whenever it (re)opens so it doesn't start blank.
let latestScene: SceneState | null = null

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.GetDisplays, () => listDisplays())

  ipcMain.handle(IpcChannels.OpenOutputWindow, (_event, displayId: number) => {
    const display = screen.getAllDisplays().find((d) => d.id === displayId)
    if (!display) throw new Error(`Unknown display id: ${displayId}`)
    const win = openOutputWindow(display)
    win.webContents.once('did-finish-load', () => {
      if (latestScene) win.webContents.send(IpcChannels.SceneUpdate, latestScene)
    })
    return true
  })

  ipcMain.handle(IpcChannels.CloseOutputWindow, () => {
    closeOutputWindow()
    latestScene = null
    return true
  })

  ipcMain.on(IpcChannels.SceneUpdate, (_event, scene: SceneState) => {
    latestScene = scene
    getOutputWindow()?.webContents.send(IpcChannels.SceneUpdate, scene)
  })

  ipcMain.handle(IpcChannels.SceneRequestSync, () => latestScene)
}
