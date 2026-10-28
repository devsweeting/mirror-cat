import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { getControlWindow } from '../windows/controlWindow'

/**
 * Whether a message came from the editor's own top-level page. Anything
 * that changes the scene, the library, the projector or settings must:
 * the projector window shares the same preload API but has no business
 * editing, and nothing else (a future iframe, a navigated page) should
 * either. Read-only scene and media queries are allowed from both windows.
 */
export function fromControlWindow(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const control = getControlWindow()
  return (
    !!control &&
    event.sender === control.webContents &&
    event.senderFrame === event.sender.mainFrame
  )
}

export function requireControlWindow(event: IpcMainInvokeEvent): void {
  if (!fromControlWindow(event)) throw new Error('Not allowed from this window')
}
