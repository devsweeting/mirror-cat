import { app, ipcMain, nativeImage } from 'electron'
import { networkInterfaces } from 'os'
import QRCode from 'qrcode'
import { IpcChannels } from '../../shared/ipcChannels'
import type { CaptureEvent, CaptureStartResult, FrameDetection } from '../../shared/capture'
import { ASSET_ID_PATTERN } from '../../shared/media'
import type { MediaLibrary } from '../media/mediaLibrary'
import { CaptureServer } from '../capture/captureServer'
import { pickLanAddress, type LanAddress } from '../capture/lanAddress'
import { getControlWindow } from '../windows/controlWindow'
import { getOutputWindow } from '../windows/outputWindow'
import { bgraToRgba, detectSize } from '../capture/frameDetect'
import { rectifiedSize, rectifyQuad } from '../capture/rectify'
import { parseCorners } from './validate'
import { vision } from '../segment/vision'
import { stopShapeFinder } from './shapeHandlers'
import { requireControlWindow } from './trust'

let active: CaptureServer | null = null
/** Whether the projector should show the scan pattern (replayed if it reopens). */
let patternOn = false

function showPattern(on: boolean): void {
  patternOn = on
  const out = getOutputWindow()
  if (out && !out.isDestroyed()) out.webContents.send(IpcChannels.CapturePatternShow, on)
}

function stopActive(): void {
  active?.stop()
  active = null
  stopShapeFinder()
  if (patternOn) showPattern(false)
}

const NO_FRAME: FrameDetection = { corners: null, markersFound: [], estimated: true }

function positiveInt(value: unknown, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 16384
    ? (value as number)
    : fallback
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
      },
      frameShown: () => patternOn
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

  ipcMain.handle(IpcChannels.CapturePattern, (event, on: unknown) => {
    requireControlWindow(event)
    showPattern(on === true)
    return true
  })

  // Finds the projector frame in a scan photo, in the vision process
  // (~0.3 s for a 1600 px scan; main only decodes the photo).
  ipcMain.handle(IpcChannels.CaptureDetectFrame, async (event, id: unknown): Promise<FrameDetection> => {
    requireControlWindow(event)
    const asset = typeof id === 'string' && ASSET_ID_PATTERN.test(id) ? library.get(id) : undefined
    const out = getOutputWindow()
    if (!asset || asset.kind !== 'image' || !out || out.isDestroyed()) return NO_FRAME
    // The pattern was drawn to fill the projector window, so that's the frame.
    const [frameWidth, frameHeight] = out.getContentSize()
    const image = nativeImage.createFromPath(library.filePath(asset))
    if (image.isEmpty()) return NO_FRAME
    const size = detectSize(image.getSize().width, image.getSize().height)
    const pixels = bgraToRgba(image.resize({ ...size, quality: 'good' }).toBitmap())
    try {
      return await vision.locateFrame(pixels, size.width, size.height, frameWidth, frameHeight)
    } catch (error) {
      console.error('[capture] frame detection failed', error)
      return NO_FRAME
    }
  })

  // Straighten the frame's part of an image (a scan photo, or the image of
  // a surface that reaches past the frame) into an image the frame's shape,
  // saved to the library. The live projector window's size wins; otherwise
  // the size the editor passes (the chosen display's).
  ipcMain.handle(
    IpcChannels.CaptureRectify,
    async (event, id: unknown, corners: unknown, frame: unknown) => {
      requireControlWindow(event)
      const asset = typeof id === 'string' && ASSET_ID_PATTERN.test(id) ? library.get(id) : undefined
      const frameInImage = parseCorners(corners)
      if (!asset || asset.kind !== 'image' || !frameInImage) throw new Error('Can’t straighten that')
      const out = getOutputWindow()
      const live = out && !out.isDestroyed() ? out.getContentSize() : null
      const requested = (frame ?? {}) as { width?: unknown; height?: unknown }
      const frameWidth = live?.[0] ?? positiveInt(requested.width, 1920)
      const frameHeight = live?.[1] ?? positiveInt(requested.height, 1080)
      const image = nativeImage.createFromPath(library.filePath(asset))
      if (image.isEmpty()) throw new Error('Couldn’t read that image')
      const { width, height } = image.getSize()
      const size = rectifiedSize(frameWidth, frameHeight)
      const pixels = rectifyQuad(image.toBitmap(), width, height, frameInImage, size.width, size.height)
      if (!pixels) throw new Error('Those corners don’t make a frame shape')
      const jpeg = nativeImage.createFromBitmap(pixels, size).toJPEG(92)
      const base = asset.name.replace(/ \(fit to projector\)$/, '')
      return library.importBuffer(jpeg, { name: `${base} (fit to projector)`, source: 'upload' })
    }
  )

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
    // A projector window opened mid-scan picks the pattern up.
    win.webContents.on('did-finish-load', () => {
      if (patternOn && win === getOutputWindow()) {
        win.webContents.send(IpcChannels.CapturePatternShow, true)
      }
    })
  })
}
