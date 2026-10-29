import type { MediaAsset } from './media'

/**
 * Phone capture ("Scan"): the editor shows a QR code; the phone opens a
 * page served by MirrorCat on the home network, takes a photo, and it lands
 * in the media library. Step 2 of "scan an object" -- see
 * docs/phone-capture.md.
 */

/** How long a scan link works. */
export const CAPTURE_SESSION_MS = 10 * 60 * 1000
/** Largest photo the phone may send (the page sends ≤4096 px JPEGs, ~2–8 MB). */
export const MAX_CAPTURE_BYTES = 25 * 1024 * 1024
/** Photos accepted per scan link (retakes included). */
export const MAX_CAPTURE_UPLOADS = 10

export interface CaptureSession {
  /** What the QR code encodes, e.g. http://192.168.1.20:53124/c/<token>. */
  url: string
  /** The QR code as an SVG document. */
  qrSvg: string
  /** Epoch ms after which the link stops working. */
  expiresAt: number
  /** Network interface the link is on (e.g. "en0"), for troubleshooting. */
  interfaceName: string
}

export type CaptureStartResult =
  | { ok: true; session: CaptureSession }
  | { ok: false; reason: 'no-network' | 'failed'; message: string }

/** Main → control window, while a scan link is open. */
export type CaptureEvent =
  | { type: 'visited' }
  | { type: 'uploading' }
  | { type: 'photo'; asset: MediaAsset }
  | { type: 'rejected'; message: string }
  | { type: 'expired' }

/** Where the projector frame was found in a scan photo. */
export interface FrameDetection {
  /**
   * The frame's corners in the photo, 0..1 of its width and height
   * (top-left, top-right, bottom-right, bottom-left), or null when too few
   * markers were found to place it.
   */
  corners: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number }
  ] | null
  /** Marker ids found: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left. */
  markersFound: number[]
  /** True unless all four markers were found -- worth a look before using. */
  estimated: boolean
}
