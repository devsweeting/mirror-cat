import ort from 'onnxruntime-node'
import { join } from 'path'
import type { SamReply, SamRequest } from './samProtocol'

/**
 * The shape finder's own process (Electron utilityProcess). Running SAM 2
 * blocks whatever thread it's on for seconds, and a native crash here
 * can't take the app down. Holds one photo's features at a time.
 */
let encoder: ort.InferenceSession | null = null
let decoder: ort.InferenceSession | null = null
let features: Record<string, ort.Tensor> | null = null

const EMPTY_POINTS = (): ort.Tensor => new ort.Tensor('float32', new Float32Array(0), [1, 1, 0, 2])
const EMPTY_LABELS = (): ort.Tensor => new ort.Tensor('int64', new BigInt64Array(0), [1, 1, 0])
const EMPTY_BOXES = (): ort.Tensor => new ort.Tensor('float32', new Float32Array(0), [1, 0, 4])

async function handle(request: SamRequest): Promise<SamReply> {
  switch (request.type) {
    case 'load': {
      if (!encoder) encoder = await ort.InferenceSession.create(join(request.dir, 'vision_encoder.onnx'))
      if (!decoder) decoder = await ort.InferenceSession.create(join(request.dir, 'prompt_encoder_mask_decoder.onnx'))
      return { id: request.id, ok: true, type: 'loaded' }
    }
    case 'embed': {
      if (!encoder) throw new Error('Not loaded')
      const out = await encoder.run({
        pixel_values: new ort.Tensor('float32', request.pixels, [1, 3, 1024, 1024])
      })
      features = {
        'image_embeddings.0': out['image_embeddings.0'],
        'image_embeddings.1': out['image_embeddings.1'],
        'image_embeddings.2': out['image_embeddings.2']
      }
      return { id: request.id, ok: true, type: 'embedded' }
    }
    case 'decode': {
      if (!decoder || !features) throw new Error('No photo yet')
      const { box, point } = request
      const out = await decoder.run({
        ...features,
        input_boxes: box ? new ort.Tensor('float32', Float32Array.from(box), [1, 1, 4]) : EMPTY_BOXES(),
        input_points: point ? new ort.Tensor('float32', Float32Array.from(point), [1, 1, 1, 2]) : EMPTY_POINTS(),
        input_labels: point ? new ort.Tensor('int64', BigInt64Array.from([1n]), [1, 1, 1]) : EMPTY_LABELS()
      })
      const masks = out.pred_masks
      return {
        id: request.id,
        ok: true,
        type: 'decoded',
        count: masks.dims[2],
        logits: new Float32Array(masks.data as Float32Array),
        ious: Array.from(out.iou_scores.data as Float32Array),
        objectScore: (out.object_score_logits.data as Float32Array)[0]
      }
    }
  }
}

process.parentPort.on('message', (event) => {
  const request = event.data as SamRequest
  handle(request)
    .then((reply) => process.parentPort.postMessage(reply))
    .catch((error: unknown) =>
      process.parentPort.postMessage({
        id: request.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      } satisfies SamReply)
    )
})
