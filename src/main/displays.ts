import { screen } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import { getControlWindow } from './windows/controlWindow'
import { closeOutputWindow, getOutputDisplayId, getOutputWindow } from './windows/outputWindow'
import type { DisplayInfo } from '../shared/types'

/**
 * Displays as the user knows them: the OS display name when there is one
 * ("LG HDR 4K", "Built-in Retina Display"), otherwise a plain fallback.
 * Resolution is not baked into the label -- the UI shows it separately.
 */
export function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay()
  let externalIndex = 0
  return screen.getAllDisplays().map((d) => {
    const isPrimary = d.id === primary.id
    const fallback = isPrimary ? 'Main display' : `External display ${++externalIndex}`
    return {
      id: d.id,
      label: d.label?.trim() || fallback,
      bounds: d.bounds,
      isPrimary
    }
  })
}

/**
 * Projectors get unplugged, switched off and moved between ports
 * mid-session. Keep the editor's display list current, and when the
 * display being projected to disappears, close the projector window
 * rather than let the OS shove it onto the laptop screen (the editor
 * hears about that through output:closed).
 */
export function watchDisplays(): void {
  const notify = (): void => {
    getControlWindow()?.webContents.send(IpcChannels.DisplaysChanged, listDisplays())
  }
  screen.on('display-added', notify)
  screen.on('display-metrics-changed', notify)
  screen.on('display-removed', (_event, removed) => {
    if (getOutputWindow() && getOutputDisplayId() === removed.id) closeOutputWindow()
    notify()
  })
}
