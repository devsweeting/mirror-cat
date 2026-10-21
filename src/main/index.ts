import { app } from 'electron'
import { join } from 'path'
import { createControlWindow, getControlWindow } from './windows/controlWindow'
import { closeOutputWindow } from './windows/outputWindow'
import { registerIpcHandlers } from './ipc/handlers'
import { installAppMenu } from './appMenu'
import { MediaLibrary } from './media/mediaLibrary'
import { registerMediaProtocol, registerMediaSchemePrivileges } from './media/protocol'
import { SceneAutosave } from './persistence/sceneAutosave'

// Point the library + autosave at a scratch folder for tests and demos
// without touching your real data: MIRRORCAT_USER_DATA=/tmp/x npm run dev
if (process.env.MIRRORCAT_USER_DATA) {
  app.setPath('userData', process.env.MIRRORCAT_USER_DATA)
}

// Custom schemes have to be declared before the app is ready.
registerMediaSchemePrivileges()

let autosave: SceneAutosave | null = null

app.whenReady().then(async () => {
  const userData = app.getPath('userData')

  const library = new MediaLibrary(join(userData, 'media'))
  await library.init()
  registerMediaProtocol(library)

  autosave = new SceneAutosave(join(userData, 'scene.json'))
  const savedSurfaces = await autosave.load()

  // Handlers before the window, so the renderer's first invoke can't race them.
  registerIpcHandlers({ library, autosave, savedSurfaces })
  installAppMenu()
  createControlWindow()

  // Dock click on macOS: reopen the editor if it's gone. Checks for the
  // editor specifically, not "any window" -- the projector window counts as
  // a window but can't be used to edit anything.
  app.on('activate', () => {
    if (!getControlWindow()) createControlWindow()
  })
})

// Write the last debounced change before exiting, so a quick edit-then-quit
// isn't lost.
app.on('before-quit', (event) => {
  if (!autosave?.hasPendingWrite) return
  event.preventDefault()
  const pending = autosave
  void pending.flush().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  closeOutputWindow()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
