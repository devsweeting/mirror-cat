import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { closeOutputWindow } from './outputWindow'
import { hardenWindow } from './security'

let controlWindow: BrowserWindow | null = null

/** The editor window, if open. The app menu sends Edit commands here. */
export function getControlWindow(): BrowserWindow | null {
  return controlWindow && !controlWindow.isDestroyed() ? controlWindow : null
}

export function createControlWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'MirrorCat',
    // Matches --room in tokens.css so the window never flashes a different
    // color before the renderer paints.
    backgroundColor: '#1d1a23',
    // On macOS the app's own top bar doubles as the title bar, with the
    // traffic lights inset into it (centered in its 52px height).
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 19 } }
      : {}),
    webPreferences: {
      // electron-vite builds the preload as ESM because package.json has
      // "type": "module" (a CJS file can't be named .js in that mode) --
      // Electron loads a .mjs preload as an ES module natively.
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  controlWindow = win
  win.on('closed', () => {
    if (controlWindow === win) controlWindow = null
    // The projector window has no frame, no taskbar entry and no controls of
    // its own, so it must never outlive the editor. On macOS the app keeps
    // running after its last window closes, which would otherwise leave a
    // fullscreen window on the projector that nothing can stop.
    closeOutputWindow()
  })

  win.once('ready-to-show', () => win.show())

  // External https links (docs, provider dashboards) open in the OS
  // browser; everything else that would leave the app page is blocked.
  hardenWindow(win)

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && rendererUrl) {
    win.loadURL(rendererUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
