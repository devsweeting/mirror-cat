import { shell, type BrowserWindow } from 'electron'

/** Only plain web links leave the app -- never file:, smb:, custom app schemes, etc. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** Same page, ignoring the #hash (the output window is "#/output"). */
export function isSamePage(target: string, current: string): boolean {
  try {
    const a = new URL(target)
    const b = new URL(current)
    return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname
  } catch {
    return false
  }
}

/**
 * Lock a window to the app's own page:
 * - new windows (target=_blank, window.open) are never created; https
 *   links open in the user's browser instead;
 * - the page can't navigate itself somewhere else (a stray link, a
 *   dropped file, injected content), which would hand that page the
 *   preload API;
 * - no <webview> tags.
 */
export function hardenWindow(win: BrowserWindow): void {
  const contents = win.webContents

  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isSamePage(url, contents.getURL())) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })

  contents.on('will-attach-webview', (event) => event.preventDefault())
}
