import { BrowserWindow, app, type Display } from 'electron'
import { join } from 'path'
import { hardenWindow } from './security'

let outputWindow: BrowserWindow | null = null

export function getOutputWindow(): BrowserWindow | null {
  return outputWindow
}

/**
 * Opens (or replaces) the borderless, fullscreen window that mirrors
 * warped content onto a specific display -- this is the window that
 * actually faces the projector, kept separate from the control window
 * on the laptop screen.
 */
export function openOutputWindow(display: Display): BrowserWindow {
  closeOutputWindow()

  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    fullscreen: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    backgroundColor: '#000000',
    webPreferences: {
      // Sandboxed: the preload is built as CommonJS (.cjs) for this, and
      // only uses contextBridge, ipcRenderer and webUtils.
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  outputWindow = win
  hardenWindow(win)

  // Only clear the shared reference if it still points at *this* window --
  // an older window's close can resolve after a newer one has replaced it.
  win.on('closed', () => {
    if (outputWindow === win) outputWindow = null
  })

  // The window has no frame or controls, and on a single-screen setup it
  // covers the editor completely. Esc always gets you out. Handled here in
  // main rather than in the page so it works even if the renderer hangs.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      win.close()
    }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && rendererUrl) {
    win.loadURL(`${rendererUrl}#/output`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'output' })
  }

  return win
}

export function closeOutputWindow(): void {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.close()
  }
  outputWindow = null
}
