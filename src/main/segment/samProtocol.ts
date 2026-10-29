/** Messages between main and the shape finder's process (samWorker.ts). */
export type SamRequest =
  | { id: number; type: 'load'; dir: string }
  /** CHW float pixels, 3×1024×1024, already normalized. */
  | { id: number; type: 'embed'; pixels: Float32Array }
  /** One prompt, in 1024×1024 input coordinates: a box [x0, y0, x1, y1] or a point [x, y]. */
  | { id: number; type: 'decode'; box?: number[]; point?: number[] }

export type SamReply =
  | { id: number; ok: false; message: string }
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

export type Decoded = Extract<SamReply, { type: 'decoded' }>
