import { BrowserWindow, app, screen, type Display } from 'electron'
import { join } from 'path'
import { hardenWindow } from './security'
import { getControlWindow } from './controlWindow'
import { IpcChannels } from '../../shared/ipcChannels'

let outputWindow: BrowserWindow | null = null
/** The display the projector window was opened on. */
let outputDisplayId: number | null = null

export function getOutputWindow(): BrowserWindow | null {
  return outputWindow
}

export function getOutputDisplayId(): number | null {
  return outputWindow ? outputDisplayId : null
}

/**
 * MIRRORCAT_OUTPUT_WINDOWED=1 opens the projector view as a small,
 * ordinary window on the chosen display instead of borderless fullscreen.
 * Lets the end-to-end tests go live without covering your screen, and is
 * handy for trying things without a projector. Unpackaged builds only.
 */
function windowedForTesting(): boolean {
  return !app.isPackaged && process.env.MIRRORCAT_OUTPUT_WINDOWED === '1'
}

/**
 * Opens (or replaces) the borderless, fullscreen window that mirrors
 * warped content onto a specific display -- this is the window that
 * actually faces the projector, kept separate from the control window
 * on the laptop screen.
 */
export function openOutputWindow(display: Display): BrowserWindow {
  closeOutputWindow()

  const placement = windowedForTesting()
    ? {
        x: display.bounds.x + 40,
        y: display.bounds.y + 40,
        width: 640,
        height: 360,
        title: 'MirrorCat projector (windowed)'
      }
    : {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        fullscreen: true,
        resizable: false,
        movable: false,
        skipTaskbar: true
      }

  const win = new BrowserWindow({
    ...placement,
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
  outputDisplayId = display.id
  hardenWindow(win)

  // macOS can move a fullscreen window to another display (displays
  // rearranged, a new primary display). Keep track of where it really is,
  // and tell the editor, whose stage takes that display's shape.
  const followDisplay = (): void => {
    if (win.isDestroyed() || outputWindow !== win) return
    const actual = screen.getDisplayMatching(win.getBounds())
    if (actual.id === outputDisplayId) return
    outputDisplayId = actual.id
    getControlWindow()?.webContents.send(IpcChannels.OutputDisplayChanged, actual.id)
  }
  win.on('move', followDisplay)
  win.on('enter-full-screen', followDisplay)
  screen.on('display-metrics-changed', followDisplay)
  screen.on('display-added', followDisplay)
  screen.on('display-removed', followDisplay)
  win.on('closed', () => {
    screen.removeListener('display-metrics-changed', followDisplay)
    screen.removeListener('display-added', followDisplay)
    screen.removeListener('display-removed', followDisplay)
  })

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
