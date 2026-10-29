import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ASSET_ID_PATTERN } from '../../shared/media'
import { MAX_MASK_BYTES, MAX_MASK_EDGE } from '../../shared/mask'
import { isNotFound, writeFileAtomic } from '../fsUtil'
import { readImageInfo } from '../media/imageInfo'

/**
 * Surface masks, as PNG files in `<userData>/masks/<sha256>.png`.
 *
 * Kept apart from the media library on purpose: masks aren't media you'd
 * browse or put on another surface, and painting saves a new one after
 * every few strokes, which would flood the Library panel. Content-addressed
 * like the library, so saving the same mask twice is free and an id's
 * bytes never change (the protocol serves them as immutable).
 *
 * The renderer produces every mask (painted or converted from an upload),
 * so only PNG is accepted, checked by its bytes and size before anything is
 * written. Masks no saved scene refers to are swept on launch.
 */
export class MaskStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
  }

  pathFor(id: string): string {
    if (!ASSET_ID_PATTERN.test(id)) throw new Error('Bad mask id')
    return join(this.dir, `${id}.png`)
  }

  async has(id: string): Promise<boolean> {
    if (!ASSET_ID_PATTERN.test(id)) return false
    try {
      return (await fs.stat(this.pathFor(id))).isFile()
    } catch {
      return false
    }
  }

  /** Validate and store a mask PNG; resolves with its id. */
  async save(bytes: Buffer): Promise<string> {
    if (bytes.length === 0 || bytes.length > MAX_MASK_BYTES) {
      throw new Error('Mask is empty or too large')
    }
    const info = readImageInfo(bytes)
    if (info.mimeType !== 'image/png') throw new Error('Masks must be PNG')
    if (info.width > MAX_MASK_EDGE || info.height > MAX_MASK_EDGE) {
      throw new Error(`Masks can be at most ${MAX_MASK_EDGE}px on a side`)
    }
    const id = createHash('sha256').update(bytes).digest('hex')
    if (!(await this.has(id))) await writeFileAtomic(this.pathFor(id), bytes)
    return id
  }

  /**
   * Delete every mask not in `keep`, plus leftovers from interrupted
   * writes. Returns how many files were removed.
   */
  async sweep(keep: ReadonlySet<string>): Promise<number> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch (error) {
      if (isNotFound(error)) return 0
      throw error
    }
    let removed = 0
    for (const name of names) {
      const match = /^([a-f0-9]{64})\.png$/.exec(name)
      if (match && keep.has(match[1])) continue
      try {
        await fs.unlink(join(this.dir, name))
        removed++
      } catch (error) {
        if (!isNotFound(error)) console.warn('[masks] could not remove', name, error)
      }
    }
    return removed
  }
}
