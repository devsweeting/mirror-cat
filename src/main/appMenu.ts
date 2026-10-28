import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import type { EditCommand } from '../shared/types'
import { getControlWindow } from './windows/controlWindow'

/**
 * The menu bar. Mostly Electron's stock roles, except Edit ▸ Undo / Redo:
 * the stock ones only undo typing in text fields, so they never touched
 * surface edits. Ours forward to the control window, which decides whether
 * the command means "undo typing" (a text field has focus) or "undo the
 * last surface change".
 *
 * They always go to the *control* window -- even when the projector window
 * is focused -- because that's where the scene and its history live.
 */
export function installAppMenu(): void {
  const send = (command: EditCommand) => (): void => {
    getControlWindow()?.webContents.send(IpcChannels.EditCommand, command)
  }

  const isMac = process.platform === 'darwin'

  // Always opens in the editor (it lives there), even from the projector.
  const settingsItem: MenuItemConstructorOptions = {
    label: isMac ? 'Settings…' : 'Settings',
    accelerator: 'CmdOrCtrl+,',
    click: () => {
      const win = getControlWindow()
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.focus()
      win.webContents.send(IpcChannels.SettingsOpen)
    }
  }

  // The stock macOS app menu has no Settings item, so it's spelled out.
  const macAppMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      settingsItem,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }

  const fileMenu: MenuItemConstructorOptions = isMac
    ? { role: 'fileMenu' }
    : { label: 'File', submenu: [settingsItem, { type: 'separator' }, { role: 'quit' }] }

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
      {
        label: 'Redo',
        accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y',
        click: send('redo')
      },
      // Windows/Linux users also expect Ctrl+Shift+Z; hidden duplicate.
      ...(isMac
        ? []
        : [
            {
              label: 'Redo',
              accelerator: 'Ctrl+Shift+Z',
              click: send('redo'),
              visible: false,
              acceleratorWorksWhenHidden: true
            } satisfies MenuItemConstructorOptions
          ]),
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    fileMenu,
    editMenu,
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
