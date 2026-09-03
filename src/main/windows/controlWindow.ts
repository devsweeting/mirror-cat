import { BrowserWindow, app, shell } from 'electron'
import { join } from 'path'

export function createControlWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'MirrorCat',
    backgroundColor: '#0b0c10',
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

  win.once('ready-to-show', () => win.show())

  // Open external links (docs, provider dashboards, etc.) in the OS browser
  // instead of navigating the app window.
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && rendererUrl) {
    win.loadURL(rendererUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
