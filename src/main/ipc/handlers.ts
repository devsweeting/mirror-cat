import { BrowserWindow, dialog, ipcMain, screen } from 'electron'
import { isAbsolute } from 'path'
import { IpcChannels } from '../../shared/ipcChannels'
import type { SceneState, Surface } from '../../shared/types'
import {
  ASSET_ID_PATTERN,
  PICKER_IMAGE_EXTENSIONS,
  PICKER_VIDEO_EXTENSIONS,
  type GeneratedImageImport,
  type MediaImportResult,
  type MediaProbeResult
} from '../../shared/media'
import { listDisplays } from '../displays'
import { openOutputWindow, closeOutputWindow, getOutputWindow } from '../windows/outputWindow'
import { getControlWindow } from '../windows/controlWindow'
import type { MediaLibrary } from '../media/mediaLibrary'
import type { SceneAutosave } from '../persistence/sceneAutosave'
import type { MaskStore } from '../masks/maskStore'
import { normalizeScene } from './sceneValidation'
import { fromControlWindow, requireControlWindow } from './trust'

/** Upper bound on one drag-and-drop batch, so a stray folder drop can't stall main. */
const MAX_IMPORT_BATCH = 100
const MAX_PROMPT_LENGTH = 4000

interface HandlerDeps {
  library: MediaLibrary
  masks: MaskStore
  autosave: SceneAutosave
  /** Surfaces read from disk at startup, handed to the control window once asked. */
  savedSurfaces: Surface[] | null
}

// Last scene received from the control window, replayed to the output
// window whenever it (re)opens so it doesn't start blank.
let latestScene: SceneState | null = null

export function registerIpcHandlers({
  library,
  masks,
  autosave,
  savedSurfaces
}: HandlerDeps): void {
  ipcMain.handle(IpcChannels.GetDisplays, () => listDisplays())

  ipcMain.handle(IpcChannels.OpenOutputWindow, (event, displayId: unknown) => {
    requireControlWindow(event)
    const display = screen.getAllDisplays().find((d) => d.id === displayId)
    if (!display) throw new Error(`Unknown display id: ${displayId}`)
    const win = openOutputWindow(display)
    win.webContents.once('did-finish-load', () => {
      if (latestScene) win.webContents.send(IpcChannels.SceneUpdate, latestScene)
    })
    // However it closed (Esc, Stop, display unplugged), tell the editor so
    // "Live" doesn't stay lit. Skipped when a newer projector window has
    // already replaced this one: the editor is still live on that one.
    win.on('closed', () => {
      if (!getOutputWindow()) getControlWindow()?.webContents.send(IpcChannels.OutputClosed)
    })
    return true
  })

  ipcMain.handle(IpcChannels.CloseOutputWindow, (event) => {
    requireControlWindow(event)
    // latestScene is kept: it's still the current scene, and reopening the
    // output window should show it immediately.
    closeOutputWindow()
    return true
  })

  ipcMain.on(IpcChannels.SceneUpdate, (event, payload: unknown) => {
    if (!fromControlWindow(event)) return
    const scene = normalizeScene(payload)
    if (!scene) {
      console.error('[ipc] rejected malformed scene update')
      return
    }
    latestScene = scene
    getOutputWindow()?.webContents.send(IpcChannels.SceneUpdate, scene)
    autosave.schedule(scene)
  })

  ipcMain.handle(IpcChannels.SceneRequestSync, () => latestScene)

  // Prefer the live scene: if the control window is reloaded (dev reload,
  // or reopened from the dock on macOS) it should pick up where it left
  // off, not jump back to what was on disk at launch.
  ipcMain.handle(IpcChannels.SceneLoadSaved, (event) => {
    requireControlWindow(event)
    return latestScene?.surfaces ?? savedSurfaces
  })

  // ---------- Media library ----------

  ipcMain.handle(IpcChannels.MediaList, () => library.list())

  ipcMain.handle(IpcChannels.MediaPickAndImport, async (event): Promise<MediaImportResult> => {
    requireControlWindow(event)
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Add images and videos to MirrorCat',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images and videos',
          extensions: [...PICKER_IMAGE_EXTENSIONS, ...PICKER_VIDEO_EXTENSIONS]
        },
        { name: 'Images', extensions: PICKER_IMAGE_EXTENSIONS },
        { name: 'Videos', extensions: PICKER_VIDEO_EXTENSIONS }
      ]
    }
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) return { imported: [], errors: [] }
    return library.importPaths(filePaths.slice(0, MAX_IMPORT_BATCH))
  })

  // Only reachable through the preload's importFiles, which resolves dropped
  // File objects to paths itself; still validated as if it weren't.
  ipcMain.handle(IpcChannels.MediaImportPaths, (event, paths: unknown) => {
    requireControlWindow(event)
    const valid = Array.isArray(paths)
      ? paths.filter((p): p is string => typeof p === 'string' && isAbsolute(p))
      : []
    return library.importPaths(valid.slice(0, MAX_IMPORT_BATCH))
  })

  ipcMain.handle(IpcChannels.MediaImportGenerated, (event, data: GeneratedImageImport) => {
    requireControlWindow(event)
    if (!(data?.bytes instanceof Uint8Array)) throw new Error('Expected image bytes')
    const buf = Buffer.from(data.bytes.buffer, data.bytes.byteOffset, data.bytes.byteLength)
    return library.importBuffer(buf, {
      name: String(data.name ?? 'Generated'),
      source: 'generated',
      prompt: typeof data.prompt === 'string' ? data.prompt.slice(0, MAX_PROMPT_LENGTH) : undefined
    })
  })

  ipcMain.handle(IpcChannels.MediaRename, (event, id: unknown, name: unknown) => {
    requireControlWindow(event)
    if (typeof id !== 'string' || !ASSET_ID_PATTERN.test(id) || typeof name !== 'string')
      return null
    return library.rename(id, name)
  })

  ipcMain.handle(IpcChannels.MediaAttachProbe, (event, id: unknown, probe: MediaProbeResult) => {
    requireControlWindow(event)
    if (
      typeof id !== 'string' ||
      !ASSET_ID_PATTERN.test(id) ||
      !probe ||
      typeof probe !== 'object'
    ) {
      return null
    }
    return library.attachProbe(id, probe)
  })

  ipcMain.handle(IpcChannels.MediaDelete, (event, id: unknown) => {
    requireControlWindow(event)
    if (typeof id !== 'string' || !ASSET_ID_PATTERN.test(id)) return false
    return library.remove(id)
  })

  // ---------- Surface masks ----------

  ipcMain.handle(IpcChannels.MaskSave, (event, bytes: unknown) => {
    requireControlWindow(event)
    if (!(bytes instanceof Uint8Array)) throw new Error('Expected mask PNG bytes')
    return masks.save(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  })

  library.onChange((assets) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.MediaChanged, assets)
    }
  })
}
