import type { DetectedShape } from './shapes'

/**
 * The detailed shape finder (SAM 2.1, tiny) -- its status as the editor
 * sees it. The model is a one-time download kept in userData/models; it
 * runs on this computer, in its own process.
 */
export type SamStatus =
  | { state: 'missing'; totalBytes: number }
  | { state: 'downloading'; receivedBytes: number; totalBytes: number }
  | { state: 'ready'; totalBytes: number }
  | { state: 'failed'; totalBytes: number; message: string }

/** A box drawn around something, 0..1 of the frame; x0 < x1, y0 < y1. */
export interface FrameBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** What a box found: a new shape, or one already in the list. */
export type BoxResult =
  | { found: 'new'; shape: DetectedShape }
  /** Already in the scan (maybe removed from the list since): pick it, adding it back if needed. */
  | { found: 'existing'; shape: DetectedShape }
  | { found: 'nothing' }

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`
}
