import { utilityProcess, type UtilityProcess } from 'electron'
import samWorkerPath from './samWorker?modulePath'
import type { Decoded, SamReply, SamRequest } from './samProtocol'

type Pending = { resolve: (reply: SamReply) => void; reject: (error: Error) => void }

// Distributive Omit, so each request type keeps its own fields.
type Request = SamRequest extends infer R ? (R extends SamRequest ? Omit<R, 'id'> : never) : never

/**
 * Talks to the shape finder's process. Started on first use, stopped when
 * the Scan dialog closes (the model holds ~300 MB). Remembers which photo
 * it last read, so boxes on the same photo answer in ~0.1 s.
 */
export class SamClient {
  private child: UtilityProcess | null = null
  private loaded: Promise<void> | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private photo: string | null = null

  constructor(private readonly modelDir: () => string) {}

  private start(): Promise<void> {
    if (this.loaded) return this.loaded
    const child = utilityProcess.fork(samWorkerPath, [], { serviceName: 'MirrorCat shape finder' })
    this.child = child
    child.on('message', (reply: SamReply) => {
      const waiting = this.pending.get(reply.id)
      if (!waiting) return
      this.pending.delete(reply.id)
      waiting.resolve(reply)
    })
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      this.loaded = null
      this.photo = null
      for (const waiting of this.pending.values()) {
        waiting.reject(new Error(`The shape finder stopped (${code})`))
      }
      this.pending.clear()
    })
    this.loaded = this.call({ type: 'load', dir: this.modelDir() }).then(() => undefined)
    this.loaded.catch(() => this.stop())
    return this.loaded
  }

  private call(request: Request): Promise<SamReply> {
    const child = this.child
    if (!child) return Promise.reject(new Error('The shape finder isn’t running'))
    const id = this.nextId++
    return new Promise<SamReply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.postMessage({ ...request, id })
    }).then((reply) => {
      if (!reply.ok) throw new Error(reply.message)
      return reply
    })
  }

  /** Read a photo (skipped if it's the one already read). `pixels` is only built when needed. */
  async usePhoto(key: string, pixels: () => Float32Array): Promise<void> {
    await this.start()
    if (this.photo === key) return
    this.photo = null
    await this.call({ type: 'embed', pixels: pixels() })
    this.photo = key
  }

  async decode(prompt: { box?: number[]; point?: number[] }): Promise<Decoded> {
    await this.start()
    return (await this.call({ type: 'decode', ...prompt })) as Decoded
  }

  stop(): void {
    const child = this.child
    this.child = null
    this.loaded = null
    this.photo = null
    for (const waiting of this.pending.values()) waiting.reject(new Error('The shape finder was stopped'))
    this.pending.clear()
    child?.kill()
  }
}
