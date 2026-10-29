import { app, ipcMain, nativeImage, net } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { MASK_PAINT_EDGE } from '../../shared/mask'
import { cornersAspect } from '../../shared/proportionalResize'
import type { BoxResult, SamStatus } from '../../shared/sam'
import type { DetectedShape } from '../../shared/shapes'
import type { MediaLibrary } from '../media/mediaLibrary'
import type { MaskStore } from '../masks/maskStore'
import { bgraToRgba } from '../capture/frameDetect'
import {
  addCandidates,
  bestInBox,
  candidateFromMask,
  combineShapes,
  regionMask,
  shapeDetectSize,
  type Candidate,
  type ShapeScan
} from '../capture/shapeDetect'
import { SAM_TOTAL_BYTES, downloadSam, samInstalled } from '../segment/samModel'
import { SAM_SIZE, gridPoints, logitsToMask, preprocessBgra } from '../segment/samMasks'
import { samModelDir, vision } from '../segment/vision'
import { getControlWindow } from '../windows/controlWindow'
import { requireControlWindow } from './trust'
import { isAssetId, parseBox, parseCorners, parseShapeIds } from './validate'

/** "Find more": SAM's own quality bars for keeping an answer. */
const MIN_PREDICTED_IOU = 0.7
const MIN_STABILITY = 0.85
const MORE_SHAPES_LIMIT = 16

/** The last shape scan, kept so masks, boxes and combining can work from it. */
let last: { assetId: string; scan: ShapeScan } | null = null

/** The Scan dialog closed: free the vision process and the scan. */
export function stopShapeFinder(): void {
  vision.stop()
  last = null
}

/**
 * Shapes: finding them (in the vision process), exact masks for picked
 * shapes, combining, and the detailed finder (SAM 2) -- its one-time
 * download, "find more" and boxes.
 */
export function registerShapeHandlers({ library, masks }: { library: MediaLibrary; masks: MaskStore }): void {
  let download: { controller: AbortController; received: number } | null = null
  let failure: string | null = null

  const status = async (): Promise<SamStatus> => {
    if (download) return { state: 'downloading', receivedBytes: download.received, totalBytes: SAM_TOTAL_BYTES }
    if (await samInstalled(samModelDir())) return { state: 'ready', totalBytes: SAM_TOTAL_BYTES }
    if (failure) return { state: 'failed', totalBytes: SAM_TOTAL_BYTES, message: failure }
    return { state: 'missing', totalBytes: SAM_TOTAL_BYTES }
  }

  const sendStatus = async (): Promise<void> => {
    const win = getControlWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IpcChannels.SamProgress, await status())
  }

  const scanFor = (id: unknown): ShapeScan | null =>
    last && typeof id === 'string' && last.assetId === id ? last.scan : null

  /** Have SAM read the fitted photo (once per photo; a read in progress is joined). */
  const readPhoto = async (assetId: string): Promise<void> => {
    const asset = library.get(assetId)
    if (!asset) throw new Error('That photo is gone. Take another scan.')
    try {
      await vision.usePhoto(assetId, () => {
        const image = nativeImage.createFromPath(library.filePath(asset))
        return preprocessBgra(image.resize({ width: SAM_SIZE, height: SAM_SIZE, quality: 'best' }).toBitmap())
      })
    } catch (error) {
      console.error('[shapes] the detailed finder failed', error)
      vision.stop()
      throw new Error('The detailed finder couldn’t read this photo. Try again, or draw the shape with the mask tools.')
    }
  }

  // ---------- Built-in finder, masks, combining ----------

  ipcMain.handle(IpcChannels.CaptureFindShapes, async (event, id: unknown): Promise<DetectedShape[]> => {
    requireControlWindow(event)
    const asset = isAssetId(id) ? library.get(id) : undefined
    if (!asset || asset.kind !== 'image') return []
    const image = nativeImage.createFromPath(library.filePath(asset))
    if (image.isEmpty()) return []
    const size = shapeDetectSize(image.getSize().width, image.getSize().height)
    const pixels = bgraToRgba(image.resize({ ...size, quality: 'good' }).toBitmap())
    try {
      const scan = await vision.findShapes(pixels, size.width, size.height)
      last = { assetId: asset.id, scan }
      // With the detailed finder here, start reading the photo now so the
      // first box answers in a blink instead of a few seconds.
      if (await samInstalled(samModelDir())) readPhoto(asset.id).catch(() => undefined)
      return scan.shapes
    } catch (error) {
      console.error('[shapes] shape finding failed', error)
      return []
    }
  })

  // An exact mask for one found shape, in the space of a surface with these
  // corners, stored like any other mask. Null if that scan is gone or the
  // corners don't make a shape.
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

  // Several shapes as one new shape (the parts stay in the scan for undo).
  ipcMain.handle(
    IpcChannels.CaptureCombineShapes,
    (event, assetId: unknown, ids: unknown): DetectedShape | null => {
      requireControlWindow(event)
      const scan = scanFor(assetId)
      const shapeIds = parseShapeIds(ids)
      if (!scan || !shapeIds || shapeIds.length < 2) return null
      return combineShapes(scan, shapeIds)
    }
  )

  // ---------- Detailed finder (SAM 2) ----------

  ipcMain.handle(IpcChannels.SamStatus, (event) => {
    requireControlWindow(event)
    return status()
  })

  ipcMain.handle(IpcChannels.SamDownload, async (event): Promise<SamStatus> => {
    requireControlWindow(event)
    if (download || (await samInstalled(samModelDir()))) return status()
    const controller = new AbortController()
    download = { controller, received: 0 }
    failure = null
    let lastSent = 0
    try {
      await downloadSam(
        samModelDir(),
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
    if (!scan || !(await samInstalled(samModelDir()))) return []
    await readPhoto(assetId as string)
    const answers = await vision.grid(gridPoints(scan.width, scan.height), MIN_PREDICTED_IOU, MIN_STABILITY)
    const found: Candidate[] = []
    for (const { logits } of answers) {
      // Unprompted answers over half the frame are the wall around things, not a thing.
      const mask = logitsToMask(logits, 0, scan.width, scan.height)
      const candidate = candidateFromMask(mask, scan.width, scan.height, { maxArea: 0.5 })
      if (candidate) found.push(candidate)
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
    if (await samInstalled(samModelDir())) {
      await readPhoto(assetId as string)
      const answer = await vision.decode({ box: [box.x0, box.y0, box.x1, box.y1].map((v) => v * SAM_SIZE) })
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
    if (existing[0]) return { found: 'existing', shape: existing[0] }
    return { found: 'nothing' }
  })

  app.on('before-quit', () => {
    download?.controller.abort()
    stopShapeFinder()
  })
}

/** Keep only the part of a mask within the box (plus a little room). */
function clipToBox(
  mask: Uint8Array,
  width: number,
  height: number,
  box: { x0: number; y0: number; x1: number; y1: number }
): Uint8Array {
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
