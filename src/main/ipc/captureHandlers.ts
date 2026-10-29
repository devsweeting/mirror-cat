import { app, ipcMain } from 'electron'
import { networkInterfaces } from 'os'
import QRCode from 'qrcode'
import { IpcChannels } from '../../shared/ipcChannels'
import type { CaptureEvent, CaptureStartResult } from '../../shared/capture'
import type { MediaLibrary } from '../media/mediaLibrary'
import { CaptureServer } from '../capture/captureServer'
import { pickLanAddress, type LanAddress } from '../capture/lanAddress'
import { getControlWindow } from '../windows/controlWindow'
import { requireControlWindow } from './trust'

let active: CaptureServer | null = null

function stopActive(): void {
  active?.stop()
  active = null
}

/**
 * Where to listen. Development builds can force an address with
 * MIRRORCAT_CAPTURE_HOST (e2e uses 127.0.0.1, since CI machines may have no
 * Wi-Fi); a packaged app ignores it.
 */
function captureAddress(): LanAddress | null {
  const forced = process.env.MIRRORCAT_CAPTURE_HOST
  if (!app.isPackaged && forced) return { address: forced, interfaceName: 'override' }
  return pickLanAddress(networkInterfaces())
}

/**
 * Scan (phone capture). One scan link at a time, opened and closed by the
 * editor's Scan dialog; the server never outlives the dialog or the editor.
 */
export function registerCaptureHandlers({ library }: { library: MediaLibrary }): void {
  const send = (event: CaptureEvent): void => {
    const win = getControlWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IpcChannels.CaptureEvent, event)
  }

  ipcMain.handle(IpcChannels.CaptureStart, async (event): Promise<CaptureStartResult> => {
    requireControlWindow(event)
    stopActive()
    const lan = captureAddress()
    if (!lan) {
      return {
        ok: false,
        reason: 'no-network',
        message:
          'This computer isn’t on a Wi-Fi or wired network. Connect it to the same network as your phone, then try again.'
      }
    }
    const server = new CaptureServer({
      host: lan.address,
      importPhoto: (bytes) =>
        library.importBuffer(bytes, {
          name: `Scan ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
          source: 'upload'
        }),
      onEvent: (e) => {
        if (e.type === 'expired' && active === server) active = null
        send(e)
      }
    })
    try {
      const { url, expiresAt } = await server.start()
      active = server
      const qrSvg = await QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#1d1a23', light: '#e8e3d9' }
      })
      return { ok: true, session: { url, qrSvg, expiresAt, interfaceName: lan.interfaceName } }
    } catch (error) {
      server.stop()
      console.error('[capture] could not start', error)
      return {
        ok: false,
        reason: 'failed',
        message: 'MirrorCat couldn’t open a scan link. Check your firewall settings, then try again.'
      }
    }
  })

  ipcMain.handle(IpcChannels.CaptureStop, (event) => {
    requireControlWindow(event)
    stopActive()
    return true
  })

  app.on('before-quit', stopActive)
  app.on('browser-window-created', (_e, win) => {
    win.on('closed', () => {
      if (!getControlWindow()) stopActive()
    })
  })
}
