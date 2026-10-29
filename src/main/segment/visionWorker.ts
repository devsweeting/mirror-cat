import type * as Ort from 'onnxruntime-node'
import { join } from 'path'
import { locateFrame } from '../capture/frameDetect'
import { findShapes } from '../capture/shapeDetect'
import { SAM_MASK_SIZE, stabilityScore } from './samMasks'
import type { GridMask, VisionReply, VisionRequest } from './visionProtocol'

/**
 * MirrorCat's vision process (an Electron utilityProcess): finding the
 * projector frame, finding shapes, and SAM 2. All of it would block
 * whatever thread it ran on -- SAM's encoder for ~3 s -- and a native crash
 * here can't take the app down. The model runtime is only loaded once SAM
 * is used. Holds one photo's SAM features at a time.
 */
type OrtModule = typeof Ort
let ort: OrtModule | null = null
let encoder: Ort.InferenceSession | null = null
let decoder: Ort.InferenceSession | null = null
let features: Record<string, Ort.Tensor> | null = null

async function runtime(): Promise<OrtModule> {
  if (!ort) {
    const loaded = (await import('onnxruntime-node')) as OrtModule & { default?: OrtModule }
    ort = loaded.default ?? loaded
  }
  return ort
}

async function decode(prompt: { box?: number[]; point?: number[] }) {
  if (!decoder || !features) throw new Error('No photo yet')
  const o = await runtime()
  const { box, point } = prompt
  const out = await decoder.run({
    ...features,
    input_boxes: box
      ? new o.Tensor('float32', Float32Array.from(box), [1, 1, 4])
      : new o.Tensor('float32', new Float32Array(0), [1, 0, 4]),
    input_points: point
      ? new o.Tensor('float32', Float32Array.from(point), [1, 1, 1, 2])
      : new o.Tensor('float32', new Float32Array(0), [1, 1, 0, 2]),
    input_labels: point
      ? new o.Tensor('int64', BigInt64Array.from([1n]), [1, 1, 1])
      : new o.Tensor('int64', new BigInt64Array(0), [1, 1, 0])
  })
  return {
    count: out.pred_masks.dims[2],
    logits: out.pred_masks.data as Float32Array,
    ious: Array.from(out.iou_scores.data as Float32Array),
    objectScore: (out.object_score_logits.data as Float32Array)[0]
  }
}

async function handle(request: VisionRequest): Promise<VisionReply> {
  const { id } = request
  switch (request.type) {
    case 'frame':
      return {
        id,
        ok: true,
        type: 'frame',
        detection: locateFrame(request.rgba, request.width, request.height, request.frameWidth, request.frameHeight)
      }
    case 'shapes':
      return { id, ok: true, type: 'shapes', scan: findShapes(request.rgba, request.width, request.height) }
    case 'load': {
      const o = await runtime()
      encoder ??= await o.InferenceSession.create(join(request.dir, 'vision_encoder.onnx'))
      decoder ??= await o.InferenceSession.create(join(request.dir, 'prompt_encoder_mask_decoder.onnx'))
      return { id, ok: true, type: 'loaded' }
    }
    case 'embed': {
      if (!encoder) throw new Error('Not loaded')
      const o = await runtime()
      features = null
      const out = await encoder.run({ pixel_values: new o.Tensor('float32', request.pixels, [1, 3, 1024, 1024]) })
      features = {
        'image_embeddings.0': out['image_embeddings.0'],
        'image_embeddings.1': out['image_embeddings.1'],
        'image_embeddings.2': out['image_embeddings.2']
      }
      return { id, ok: true, type: 'embedded' }
    }
    case 'decode': {
      const answer = await decode(request)
      // Copied out: the tensor's buffer belongs to onnxruntime.
      return { id, ok: true, type: 'decoded', ...answer, logits: new Float32Array(answer.logits) }
    }
    case 'grid': {
      // Filtered here, so only the few useful masks cross to main.
      const masks: GridMask[] = []
      const size = SAM_MASK_SIZE * SAM_MASK_SIZE
      for (const point of request.points) {
        const answer = await decode({ point })
        if (answer.objectScore <= 0) continue
        for (let k = 0; k < answer.count; k++) {
          if (answer.ious[k] < request.minIou || stabilityScore(answer.logits, k) < request.minStability) continue
          masks.push({ logits: answer.logits.slice(k * size, (k + 1) * size), iou: answer.ious[k] })
        }
      }
      return { id, ok: true, type: 'grid', masks }
    }
  }
}

process.parentPort.on('message', (event) => {
  const request = event.data as VisionRequest
  handle(request)
    .then((reply) => process.parentPort.postMessage(reply))
    .catch((error: unknown) =>
      process.parentPort.postMessage({
        id: request.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      } satisfies VisionReply)
    )
})
