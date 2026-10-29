import { app, ipcMain, nativeImage, net } from 'electron'
import { join } from 'path'
import { IpcChannels } from '../../shared/ipcChannels'
import { ASSET_ID_PATTERN } from '../../shared/media'
import { MASK_PAINT_EDGE } from '../../shared/mask'
import { cornersAspect } from '../../shared/proportionalResize'
import type { BoxResult, FrameBox, SamStatus } from '../../shared/sam'
import type { DetectedShape } from '../../shared/shapes'
import type { CornerSet } from '../../shared/types'
import type { MediaLibrary } from '../media/mediaLibrary'
import type { MaskStore } from '../masks/maskStore'
import { bgraToRgba } from '../capture/frameDetect'
import {
  addCandidates,
  bestInBox,
  candidateFromMask,
  findShapes,
  regionMask,
  shapeDetectSize,
  type Candidate,
  type ShapeScan
} from '../capture/shapeDetect'
import { SamClient } from '../segment/samClient'
import { SAM_DIR_NAME, SAM_TOTAL_BYTES, downloadSam, samInstalled } from '../segment/samModel'
import { SAM_SIZE, gridPoints, logitsToMask, preprocessBgra, stabilityScore } from '../segment/samMasks'
import { getControlWindow } from '../windows/controlWindow'
import { requireControlWindow } from './trust'

/** "Find more": SAM's own quality bars for keeping an answer. */
const MIN_PREDICTED_IOU = 0.7
const MIN_STABILITY = 0.85
const MORE_SHAPES_LIMIT = 16

let sam: SamClient | null = null

/** Free the shape finder's process (the Scan dialog closed). */
export function stopShapeFinder(): void {
  sam?.stop()
}

function parseCorners(value: unknown): CornerSet | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const ok = value.every(
    (c) =>
      c &&
      typeof c === 'object' &&
      Number.isFinite((c as { x: number }).x) &&
      Number.isFinite((c as { y: number }).y) &&
      Math.abs((c as { x: number }).x) < 100 &&
      Math.abs((c as { y: number }).y) < 100
  )
  return ok ? (value.map((c) => ({ x: c.x, y: c.y })) as CornerSet) : null
}

/** A box inside the frame with some size to it, or null. */
function parseBox(value: unknown): FrameBox | null {
  const b = value as Partial<FrameBox> | null
  if (!b || typeof b !== 'object') return null
  const v = [b.x0, b.y0, b.x1, b.y1]
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const clamp = (n: number): number => Math.min(1, Math.max(0, n))
  const box = { x0: clamp(b.x0!), y0: clamp(b.y0!), x1: clamp(b.x1!), y1: clamp(b.y1!) }
  return box.x1 - box.x0 > 0.01 && box.y1 - box.y0 > 0.01 ? box : null
}

/**
 * Shapes: the built-in finder, exact masks for picked shapes, and the
 * detailed finder (SAM 2) -- its one-time download, "find more" and boxes.
 */
export function registerShapeHandlers({ library, masks }: { library: MediaLibrary; masks: MaskStore }): void {
  // Dev/e2e can point at an existing model; a packaged app always uses userData.
  const override = !app.isPackaged ? process.env.MIRRORCAT_SAM_DIR : undefined
  const modelDir = (): string => override || join(app.getPath('userData'), 'models', SAM_DIR_NAME)
  sam = new SamClient(modelDir)

  // The last shape scan, kept so masks and boxes can work from it.
  let last: { assetId: string; scan: ShapeScan } | null = null
  let download: { controller: AbortController; received: number } | null = null
  let failure: string | null = null

  const status = async (): Promise<SamStatus> => {
    if (download) return { state: 'downloading', receivedBytes: download.received, totalBytes: SAM_TOTAL_BYTES }
    if (await samInstalled(modelDir())) return { state: 'ready', totalBytes: SAM_TOTAL_BYTES }
    if (failure) return { state: 'failed', totalBytes: SAM_TOTAL_BYTES, message: failure }
    return { state: 'missing', totalBytes: SAM_TOTAL_BYTES }
  }

  const sendStatus = async (): Promise<void> => {
    const win = getControlWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IpcChannels.SamProgress, await status())
  }

  const scanFor = (id: unknown): ShapeScan | null =>
    last && typeof id === 'string' && last.assetId === id ? last.scan : null

  /** Have SAM read the fitted photo (once per photo). */
  const readPhoto = async (assetId: string): Promise<void> => {
    const asset = library.get(assetId)
    if (!asset) throw new Error('That photo is gone')
    try {
      await sam!.usePhoto(assetId, () => {
        const image = nativeImage.createFromPath(library.filePath(asset))
        return preprocessBgra(image.resize({ width: SAM_SIZE, height: SAM_SIZE, quality: 'best' }).toBitmap())
      })
    } catch (error) {
      console.error('[shapes] the detailed finder failed', error)
      sam!.stop()
      throw new Error('The detailed finder couldn’t read this photo. Try again, or draw the shape with the mask tools.')
    }
  }

  // ---------- Built-in finder and masks ----------

  ipcMain.handle(IpcChannels.CaptureFindShapes, (event, id: unknown): DetectedShape[] => {
    requireControlWindow(event)
    const asset = typeof id === 'string' && ASSET_ID_PATTERN.test(id) ? library.get(id) : undefined
    if (!asset || asset.kind !== 'image') return []
    const image = nativeImage.createFromPath(library.filePath(asset))
    if (image.isEmpty()) return []
    const size = shapeDetectSize(image.getSize().width, image.getSize().height)
    const pixels = bgraToRgba(image.resize({ ...size, quality: 'good' }).toBitmap())
    try {
      const scan = findShapes(pixels, size.width, size.height)
      last = { assetId: asset.id, scan }
      return scan.shapes
    } catch (error) {
      console.error('[shapes] shape finding failed', error)
      return []
    }
  })

  // An exact mask for one found shape, in the space of a surface with these
  // corners, stored like any other mask. Null if that scan is gone (the app
  // restarted) or the corners don't make a shape.
  ipcMain.handle(
    IpcChannels.CaptureShapeMask,
    async (event, assetId: unknown, shapeId: unknown, corners: unknown): Promise<string | null> => {
      requireControlWindow(event)
      const fitted = parseCorners(corners)
      const scan = scanFor(assetId)
      if (!scan || typeof shapeId !== 'string' || !fitted) return null
      const region = scan.regions.get(shapeId)
      if (!region) return null
      const aspect = Math.min(8, Math.max(1 / 8, cornersAspect(fitted, scan.width, scan.height)))
      const width = Math.round(aspect >= 1 ? MASK_PAINT_EDGE : MASK_PAINT_EDGE * aspect)
      const height = Math.round(aspect >= 1 ? MASK_PAINT_EDGE / aspect : MASK_PAINT_EDGE)
      const gray = regionMask(region, scan.width, scan.height, fitted, width, height)
      if (!gray) return null
      const bgra = Buffer.alloc(width * height * 4)
      for (let i = 0; i < gray.length; i++) {
        bgra[i * 4] = bgra[i * 4 + 1] = bgra[i * 4 + 2] = gray[i]
        bgra[i * 4 + 3] = 255
      }
      return masks.save(nativeImage.createFromBitmap(bgra, { width, height }).toPNG())
    }
  )

  // ---------- Detailed finder (SAM 2) ----------

  ipcMain.handle(IpcChannels.SamStatus, (event) => {
    requireControlWindow(event)
    return status()
  })

  ipcMain.handle(IpcChannels.SamDownload, async (event): Promise<SamStatus> => {
    requireControlWindow(event)
    if (download || (await samInstalled(modelDir()))) return status()
    const controller = new AbortController()
    download = { controller, received: 0 }
    failure = null
    let lastSent = 0
    try {
      await downloadSam(
        modelDir(),
        (url, init) => net.fetch(url, init),
        (received) => {
          if (download) download.received = received
          const now = Date.now()
          if (now - lastSent > 120) {
            lastSent = now
            void sendStatus()
          }
        },
        controller.signal
      )
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('[shapes] model download failed', error)
        failure = 'The download didn’t finish. Check your internet connection, then try again.'
      }
    } finally {
      download = null
    }
    await sendStatus()
    return status()
  })

  ipcMain.handle(IpcChannels.SamCancel, async (event) => {
    requireControlWindow(event)
    download?.controller.abort()
    return status()
  })

  // "Find more": prompt SAM with a grid of points over the photo and keep
  // the confident, crisp answers that aren't shapes already in the list.
  ipcMain.handle(IpcChannels.CaptureFindMore, async (event, assetId: unknown): Promise<DetectedShape[]> => {
    requireControlWindow(event)
    const scan = scanFor(assetId)
    if (!scan || !(await samInstalled(modelDir()))) return []
    await readPhoto(assetId as string)
    const found: Candidate[] = []
    for (const point of gridPoints(scan.width, scan.height)) {
      const answer = await sam!.decode({ point })
      if (answer.objectScore <= 0) continue
      for (let k = 0; k < answer.count; k++) {
        if (answer.ious[k] < MIN_PREDICTED_IOU || stabilityScore(answer.logits, k) < MIN_STABILITY) continue
        const mask = logitsToMask(answer.logits, k, scan.width, scan.height)
        // Unprompted answers over half the frame are the wall around things, not a thing.
        const candidate = candidateFromMask(mask, scan.width, scan.height, { maxArea: 0.5 })
        if (candidate) found.push(candidate)
      }
    }
    return addCandidates(scan, found, MORE_SHAPES_LIMIT).added
  })

  // A box drawn around something: SAM's answer for it when the detailed
  // finder is installed, else the built-in finder's best match.
  ipcMain.handle(IpcChannels.CaptureFindInBox, async (event, assetId: unknown, value: unknown): Promise<BoxResult> => {
    requireControlWindow(event)
    const scan = scanFor(assetId)
    const box = parseBox(value)
    if (!scan || !box) return { found: 'nothing' }
    let candidate: Candidate | null = null
    if (await samInstalled(modelDir())) {
      await readPhoto(assetId as string)
      const answer = await sam!.decode({ box: [box.x0, box.y0, box.x1, box.y1].map((v) => v * SAM_SIZE) })
      // Best-rated mask first; the box says what you meant, so it may touch up to three sides.
      const order = answer.ious.map((iou, k) => ({ iou, k })).sort((a, b) => b.iou - a.iou)
      for (const { k } of order) {
        const mask = clipToBox(logitsToMask(answer.logits, k, scan.width, scan.height), scan.width, scan.height, box)
        candidate = candidateFromMask(mask, scan.width, scan.height, { minSolidity: 0.2, maxBorders: 3 })
        if (candidate) break
      }
    } else {
      candidate = bestInBox(scan, box)
    }
    if (!candidate) return { found: 'nothing' }
    const { added, existing } = addCandidates(scan, [candidate], 1)
    if (added[0]) return { found: 'new', shape: added[0] }
    if (existing[0]) return { found: 'existing', shapeId: existing[0].id }
    return { found: 'nothing' }
  })

  app.on('before-quit', () => {
    download?.controller.abort()
    sam?.stop()
  })
}

/** Keep only the part of a mask within the box (plus a little room). */
function clipToBox(mask: Uint8Array, width: number, height: number, box: FrameBox): Uint8Array {
  const m = 0.03
  const x0 = Math.floor((box.x0 - m) * width)
  const x1 = Math.ceil((box.x1 + m) * width)
  const y0 = Math.floor((box.y0 - m) * height)
  const y1 = Math.ceil((box.y1 + m) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) mask[y * width + x] = 0
    }
  }
  return mask
}
