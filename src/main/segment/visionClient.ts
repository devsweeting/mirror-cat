import { utilityProcess, type UtilityProcess } from 'electron'
import visionWorkerPath from './visionWorker?modulePath'
import type { FrameDetection } from '../../shared/capture'
import type { ShapeScan } from '../capture/shapeDetect'
import type { Decoded, GridMask, VisionReply, VisionRequest } from './visionProtocol'

type Pending = { resolve: (reply: VisionReply) => void; reject: (error: Error) => void }
type OkType = Extract<VisionReply, { ok: true }>['type']

// Distributive Omit, so each request type keeps its own fields.
type Request = VisionRequest extends infer R ? (R extends VisionRequest ? Omit<R, 'id'> : never) : never

/**
 * Talks to the vision process. Started on first use and stopped when the
 * Scan dialog closes (SAM holds ~300 MB). Remembers which photo SAM last
 * read -- and the read in progress -- so boxes on the same photo answer
 * in ~0.1 s and a box drawn mid-read waits for that read, not a second one.
 */
export class VisionClient {
  private child: UtilityProcess | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private samLoaded: Promise<void> | null = null
  private photo: { key: string; ready: Promise<void> } | null = null

  constructor(private readonly modelDir: () => string) {}

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(visionWorkerPath, [], { serviceName: 'MirrorCat vision' })
    this.child = child
    child.on('message', (reply: VisionReply) => {
      const waiting = this.pending.get(reply.id)
      if (!waiting) return
      this.pending.delete(reply.id)
      waiting.resolve(reply)
    })
    child.on('exit', (code) => {
      if (this.child === child) this.reset(new Error(`The vision process stopped (${code})`))
    })
    return child
  }

  private reset(error: Error): void {
    this.child = null
    this.samLoaded = null
    this.photo = null
    for (const waiting of this.pending.values()) waiting.reject(error)
    this.pending.clear()
  }

  /** Send a request; resolves with the reply of the expected type, or rejects with the worker's message. */
  private call<K extends OkType>(request: Request, expected: K): Promise<Extract<VisionReply, { type: K }>> {
    const child = this.ensureChild()
    const id = this.nextId++
    return new Promise<VisionReply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.postMessage({ ...request, id })
    }).then((reply) => {
      if (!reply.ok) throw new Error(reply.message)
      if (reply.type !== expected) throw new Error(`Unexpected reply: ${reply.type}`)
      return reply as Extract<VisionReply, { type: K }>
    })
  }

  async locateFrame(
    rgba: Uint8Array,
    width: number,
    height: number,
    frameWidth: number,
    frameHeight: number
  ): Promise<FrameDetection> {
    return (await this.call({ type: 'frame', rgba, width, height, frameWidth, frameHeight }, 'frame')).detection
  }

  async findShapes(rgba: Uint8Array, width: number, height: number): Promise<ShapeScan> {
    return (await this.call({ type: 'shapes', rgba, width, height }, 'shapes')).scan
  }

  private loadSam(): Promise<void> {
    this.samLoaded ??= this.call({ type: 'load', dir: this.modelDir() }, 'loaded').then(() => undefined)
    this.samLoaded.catch(() => (this.samLoaded = null))
    return this.samLoaded
  }

  /**
   * Have SAM read a photo. Skipped if it's the one already read; joins the
   * read if it's the one being read. `pixels` is only built when needed.
   */
  usePhoto(key: string, pixels: () => Float32Array): Promise<void> {
    if (this.photo?.key === key) return this.photo.ready
    const ready = this.loadSam()
      .then(() => this.call({ type: 'embed', pixels: pixels() }, 'embedded'))
      .then(() => undefined)
    const photo = { key, ready }
    this.photo = photo
    ready.catch(() => {
      if (this.photo === photo) this.photo = null
    })
    return ready
  }

  decode(prompt: { box?: number[]; point?: number[] }): Promise<Decoded> {
    return this.call({ type: 'decode', ...prompt }, 'decoded')
  }

  async grid(points: [number, number][], minIou: number, minStability: number): Promise<GridMask[]> {
    return (await this.call({ type: 'grid', points, minIou, minStability }, 'grid')).masks
  }

  stop(): void {
    const child = this.child
    this.reset(new Error('The vision process was stopped'))
    child?.kill()
  }
}
