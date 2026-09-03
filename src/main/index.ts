import { app, BrowserWindow } from 'electron'
import { createControlWindow } from './windows/controlWindow'
import { closeOutputWindow } from './windows/outputWindow'
import { registerIpcHandlers } from './ipc/handlers'

app.whenReady().then(() => {
  createControlWindow()
  registerIpcHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createControlWindow()
    }
  })
})

app.on('window-all-closed', () => {
  closeOutputWindow()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
