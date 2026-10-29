import type { FrameDetection } from '../../shared/capture'
import type { ShapeScan } from '../capture/shapeDetect'

/** One accepted answer from a point grid: one mask's logits and how good SAM thinks it is. */
export interface GridMask {
  /** 256 × 256 logits; > 0 is inside. */
  logits: Float32Array
  iou: number
}

/**
 * Messages between main and the vision process (visionWorker.ts). Pixels
 * are decoded in main (nativeImage lives there) and sent as RGBA.
 */
export type VisionRequest =
  | { id: number; type: 'frame'; rgba: Uint8Array; width: number; height: number; frameWidth: number; frameHeight: number }
  | { id: number; type: 'shapes'; rgba: Uint8Array; width: number; height: number }
  | { id: number; type: 'load'; dir: string }
  /** CHW float pixels, 3×1024×1024, already normalized. */
  | { id: number; type: 'embed'; pixels: Float32Array }
  /** One prompt, in 1024×1024 input coordinates: a box [x0, y0, x1, y1] or a point [x, y]. */
  | { id: number; type: 'decode'; box?: number[]; point?: number[] }
  /** Many single-point prompts; only confident, crisp answers come back. */
  | { id: number; type: 'grid'; points: [number, number][]; minIou: number; minStability: number }

export type VisionReply =
  | { id: number; ok: false; message: string }
  | { id: number; ok: true; type: 'frame'; detection: FrameDetection }
  | { id: number; ok: true; type: 'shapes'; scan: ShapeScan }
  | { id: number; ok: true; type: 'loaded' }
  | { id: number; ok: true; type: 'embedded' }
  | {
      id: number
      ok: true
      type: 'decoded'
      /** How many masks (SAM answers three: part, bigger part, whole). */
      count: number
      /** count × 256 × 256 logits; > 0 is inside. */
      logits: Float32Array
      /** The model's own guess at each mask's quality, 0..1. */
      ious: number[]
      /** > 0 when it thinks there's an object there at all. */
      objectScore: number
    }
  | { id: number; ok: true; type: 'grid'; masks: GridMask[] }

export type Decoded = Extract<VisionReply, { type: 'decoded' }>
