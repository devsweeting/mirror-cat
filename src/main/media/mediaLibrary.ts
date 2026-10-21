import { nativeImage } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { createReadStream, createWriteStream, promises as fs } from 'fs'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { basename, extname, join } from 'path'
import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  ASSET_ID_PATTERN,
  type AcceptedImageType,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  type AcceptedVideoType,
  type MediaAsset,
  type MediaImportResult,
  type MediaProbeResult,
  type MediaSource
} from '../../shared/media'
import { isNotFound, quarantine, writeFileAtomic } from '../fsUtil'
import { ImportRejectedError, SNIFF_BYTES, readImageInfo, sniffMedia } from './imageInfo'

/** Thumbnails come from our own renderer; anything bigger than this isn't one. */
const MAX_PROBE_THUMB_BYTES = 2 * 1024 * 1024

const INDEX_VERSION = 1
/** Longest side of a library thumbnail, in pixels (2x the grid tile size). */
const THUMB_MAX = 320
const MAX_NAME_LENGTH = 80
/**
 * Deleting a file another window is still streaming fails on Windows
 * (EBUSY/EPERM) until that window lets go -- which it does as soon as the
 * library change reaches it. Retry for a couple of seconds before giving up
 * and leaving it for the start-up sweep.
 */
const DELETE_RETRY_DELAYS_MS = [100, 250, 500, 1000]
/** Library file names: `<sha256>.<ext>` (originals) and `<sha256>.jpg` (thumbs). */
const LIBRARY_FILE_PATTERN = /^([a-f0-9]{64})\.[a-z0-9]+$/

interface LibraryIndex {
  version: number
  assets: MediaAsset[]
}

interface ImportMeta {
  name: string
  source: MediaSource
  prompt?: string
}

/**
 * The app-wide media library: image files stored content-addressed under
 * `<userData>/media/files/<sha256>.<ext>`, thumbnails under `thumbs/`, and
 * a `library.json` index. Owned entirely by the main process; renderers
 * reach it over IPC (metadata) and the mirrorcat-media:// protocol (bytes).
 */
export class MediaLibrary {
  private assets = new Map<string, MediaAsset>()
  private listeners = new Set<(assets: MediaAsset[]) => void>()
  /** Serialises index writes so two quick imports can't interleave. */
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly root: string) {}

  private get filesDir(): string {
    return join(this.root, 'files')
  }

  private get thumbsDir(): string {
    return join(this.root, 'thumbs')
  }

  private get indexPath(): string {
    return join(this.root, 'library.json')
  }

  async init(): Promise<void> {
    await fs.mkdir(this.filesDir, { recursive: true })
    await fs.mkdir(this.thumbsDir, { recursive: true })
    let indexLoaded = false
    try {
      const raw = JSON.parse(await fs.readFile(this.indexPath, 'utf8')) as Partial<LibraryIndex>
      for (const entry of Array.isArray(raw.assets) ? raw.assets : []) {
        const asset = normalizeAsset(entry)
        if (asset) this.assets.set(asset.id, asset)
        else console.warn('[media] skipped an invalid library.json entry')
      }
      indexLoaded = true
    } catch (error) {
      if (!isNotFound(error)) {
        const moved = await quarantine(this.indexPath)
        console.error(`[media] library.json unreadable, moved to ${moved}`, error)
      }
    }
    // Only trust the index to decide what's an orphan when it actually
    // loaded: with a missing or quarantined index, every file would look
    // like one.
    if (indexLoaded) await this.sweepOrphans()
  }

  /**
   * Remove files nothing points at: originals and thumbs whose asset is no
   * longer in the index (a delete that couldn't remove a locked file, or a
   * crash between index write and file removal), and temp files left by an
   * interrupted import or atomic write. Best effort; never fails start-up.
   */
  private async sweepOrphans(): Promise<void> {
    for (const dir of [this.filesDir, this.thumbsDir]) {
      let names: string[]
      try {
        names = await fs.readdir(dir)
      } catch {
        continue
      }
      for (const name of names) {
        const match = LIBRARY_FILE_PATTERN.exec(name)
        const orphan = match ? !this.assets.has(match[1]) : name.endsWith('.tmp')
        if (!orphan) continue
        await fs.rm(join(dir, name), { force: true }).catch((error) => {
          console.warn(`[media] couldn't remove orphan ${name}`, error)
        })
      }
    }
  }

  /** Newest first, matching how the library panel shows them. */
  list(): MediaAsset[] {
    return [...this.assets.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): MediaAsset | undefined {
    return this.assets.get(id)
  }

  filePath(asset: MediaAsset): string {
    return join(this.filesDir, `${asset.id}.${asset.ext}`)
  }

  thumbPath(asset: MediaAsset): string {
    return join(this.thumbsDir, `${asset.id}.jpg`)
  }

  onChange(listener: (assets: MediaAsset[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Import files from disk one at a time (keeps memory flat for big batches). */
  async importPaths(paths: string[]): Promise<MediaImportResult> {
    const result: MediaImportResult = { imported: [], errors: [] }
    for (const path of paths) {
      const displayName = basename(path)
      try {
        const stat = await fs.stat(path)
        if (!stat.isFile()) throw new ImportRejectedError('Folders can’t be imported.')
        if (stat.size === 0) throw new ImportRejectedError('The file is empty.')
        const sniffed = sniffMedia(await readHead(path, SNIFF_BYTES))
        const name = basename(path, extname(path))
        let asset: MediaAsset
        if (sniffed.kind === 'video') {
          if (stat.size > MAX_VIDEO_BYTES) throw tooLarge(MAX_VIDEO_BYTES)
          asset = await this.importVideoFile(path, stat.size, sniffed.mimeType, sniffed.ext, name)
        } else {
          if (stat.size > MAX_IMAGE_BYTES) throw tooLarge(MAX_IMAGE_BYTES)
          asset = await this.importBuffer(await fs.readFile(path), { name, source: 'upload' })
        }
        result.imported.push(asset)
      } catch (error) {
        result.errors.push({ name: displayName, message: describeImportError(error) })
      }
    }
    return result
  }

  /**
   * Videos can be gigabytes, so they're streamed: hashed while being copied
   * to a temp file, then renamed to their content id. Size, duration and the
   * poster frame are filled in later by the renderer (attachProbe), because
   * only Chromium can decode them.
   */
  private async importVideoFile(
    path: string,
    bytes: number,
    mimeType: AcceptedVideoType,
    ext: string,
    name: string
  ): Promise<MediaAsset> {
    const tmp = join(this.filesDir, `.import-${randomBytes(6).toString('hex')}.tmp`)
    try {
      const id = await copyAndHash(path, tmp)
      const existing = this.assets.get(id)
      if (existing) {
        await fs.rm(tmp, { force: true })
        return existing
      }
      const asset: MediaAsset = {
        id,
        kind: 'video',
        name: cleanName(name),
        mimeType,
        ext,
        width: 0,
        height: 0,
        bytes,
        source: 'upload',
        createdAt: Date.now(),
        hasThumbnail: false,
        probed: false
      }
      await fs.rename(tmp, this.filePath(asset))
      this.assets.set(id, asset)
      await this.persist()
      return asset
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  /** Images only (uploads read from disk, and AI-generated bytes). */
  async importBuffer(buf: Buffer, meta: ImportMeta): Promise<MediaAsset> {
    if (buf.length > MAX_IMAGE_BYTES) throw tooLarge(MAX_IMAGE_BYTES)
    const info = readImageInfo(buf)
    const id = createHash('sha256').update(buf).digest('hex')

    // Same bytes already in the library: reuse it rather than duplicating.
    const existing = this.assets.get(id)
    if (existing) return existing

    const asset: MediaAsset = {
      id,
      kind: 'image',
      name: cleanName(meta.name),
      mimeType: info.mimeType,
      ext: info.ext,
      width: info.width,
      height: info.height,
      bytes: buf.length,
      source: meta.source,
      ...(meta.prompt ? { prompt: meta.prompt } : {}),
      createdAt: Date.now(),
      hasThumbnail: false
    }
    await writeFileAtomic(this.filePath(asset), buf)
    asset.hasThumbnail = await this.writeThumbnail(asset, buf)
    // nativeImage made a thumbnail: nothing left for the renderer to measure.
    asset.probed = asset.hasThumbnail

    this.assets.set(id, asset)
    await this.persist()
    return asset
  }

  /**
   * Store what the renderer measured: real pixel size (after EXIF rotation),
   * duration, whether it plays at all, and a JPEG thumbnail / poster frame.
   */
  async attachProbe(id: string, probe: MediaProbeResult): Promise<MediaAsset | null> {
    const asset = this.assets.get(id)
    if (!asset) return null
    const updated: MediaAsset = { ...asset, probed: true }

    if (isPositiveInt(probe.width) && isPositiveInt(probe.height)) {
      updated.width = probe.width
      updated.height = probe.height
    }
    if (asset.kind === 'video') {
      updated.playable = probe.playable === true
      if (isPositiveInt(probe.durationMs)) updated.durationMs = probe.durationMs
    }

    const thumb = probe.thumbnail
    if (
      thumb instanceof Uint8Array &&
      thumb.byteLength > 3 &&
      thumb.byteLength <= MAX_PROBE_THUMB_BYTES &&
      thumb[0] === 0xff &&
      thumb[1] === 0xd8 // JPEG
    ) {
      await writeFileAtomic(this.thumbPath(asset), thumb)
      updated.hasThumbnail = true
    }

    this.assets.set(id, updated)
    await this.persist()
    return updated
  }

  async rename(id: string, name: string): Promise<MediaAsset | null> {
    const asset = this.assets.get(id)
    const trimmed = cleanName(name, '')
    if (!asset || !trimmed) return asset ?? null
    const updated = { ...asset, name: trimmed }
    this.assets.set(id, updated)
    await this.persist()
    return updated
  }

  async remove(id: string): Promise<boolean> {
    const asset = this.assets.get(id)
    if (!asset) return false
    this.assets.delete(id)
    // persist() also broadcasts the change, which is what makes every
    // window drop its <video> / texture for this asset and release the file.
    await this.persist()
    // Files go after the index, so a crash in between leaves an orphan file
    // (swept on next launch) rather than an index entry pointing at nothing.
    // The asset is gone from the library either way, so a file that stays
    // locked is logged, not reported as a failed delete.
    await removeWithRetry(this.filePath(asset))
    await removeWithRetry(this.thumbPath(asset))
    return true
  }

  /**
   * Best effort: nativeImage decodes PNG/JPEG everywhere (and more formats
   * on macOS). When it can't, the thumb URL falls back to the original.
   */
  private async writeThumbnail(asset: MediaAsset, buf: Buffer): Promise<boolean> {
    try {
      const image = nativeImage.createFromBuffer(buf)
      if (image.isEmpty()) return false
      const { width, height } = image.getSize()
      const scale = Math.min(1, THUMB_MAX / Math.max(width, height))
      const thumb = image.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: 'good'
      })
      await writeFileAtomic(this.thumbPath(asset), thumb.toJPEG(82))
      return true
    } catch (error) {
      console.warn(`[media] thumbnail failed for ${asset.id}`, error)
      return false
    }
  }

  private persist(): Promise<void> {
    const snapshot: LibraryIndex = { version: INDEX_VERSION, assets: this.list() }
    const write = this.writeChain.then(() =>
      writeFileAtomic(this.indexPath, JSON.stringify(snapshot, null, 2))
    )
    // Keep the chain alive even if one write fails.
    this.writeChain = write.catch((error) => console.error('[media] index write failed', error))
    return write.then(() => this.emit())
  }

  private emit(): void {
    const assets = this.list()
    for (const listener of this.listeners) listener(assets)
  }
}

/**
 * Defensive read of one library.json entry. `ext` becomes part of a file
 * path and `mimeType` a response header, so neither is taken on trust:
 * the type must be one we accept and the extension must be the one that
 * type maps to. Entries written before video support have no `kind`; it's
 * derived from the type.
 */
export function normalizeAsset(value: unknown): MediaAsset | null {
  if (!value || typeof value !== 'object') return null
  const a = value as Partial<Record<keyof MediaAsset, unknown>>
  if (typeof a.id !== 'string' || !ASSET_ID_PATTERN.test(a.id)) return null

  const mimeType = a.mimeType
  let kind: MediaAsset['kind']
  let ext: string
  if (typeof mimeType === 'string' && mimeType in ACCEPTED_IMAGE_TYPES) {
    kind = 'image'
    ext = ACCEPTED_IMAGE_TYPES[mimeType as AcceptedImageType]
  } else if (typeof mimeType === 'string' && mimeType in ACCEPTED_VIDEO_TYPES) {
    kind = 'video'
    ext = ACCEPTED_VIDEO_TYPES[mimeType as AcceptedVideoType]
  } else {
    return null
  }
  if (a.ext !== ext) return null

  const count = (n: unknown): number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0
  const asset: MediaAsset = {
    id: a.id,
    kind,
    name: cleanName(typeof a.name === 'string' ? a.name : ''),
    mimeType: mimeType as MediaAsset['mimeType'],
    ext,
    width: count(a.width),
    height: count(a.height),
    bytes: count(a.bytes),
    source: a.source === 'generated' ? 'generated' : 'upload',
    createdAt: count(a.createdAt),
    hasThumbnail: a.hasThumbnail === true
  }
  if (typeof a.prompt === 'string') asset.prompt = a.prompt
  if (typeof a.probed === 'boolean') asset.probed = a.probed
  if (typeof a.playable === 'boolean') asset.playable = a.playable
  if (isPositiveInt(a.durationMs)) asset.durationMs = a.durationMs
  return asset
}

async function removeWithRetry(path: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rm(path, { force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const retryable = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
      if (!retryable || attempt >= DELETE_RETRY_DELAYS_MS.length) {
        console.warn(`[media] couldn't remove ${path}; will retry on next launch`, error)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, DELETE_RETRY_DELAYS_MS[attempt]))
    }
  }
}

function cleanName(name: string, fallback = 'Untitled'): string {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
  return trimmed || fallback
}

function tooLarge(limit: number): ImportRejectedError {
  const label =
    limit >= 1024 * 1024 * 1024
      ? `${Math.round(limit / 1024 / 1024 / 1024)} GB per video`
      : `${Math.round(limit / 1024 / 1024)} MB per image`
  return new ImportRejectedError(`Too large. The limit is ${label}.`)
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e9
}

async function readHead(path: string, length: number): Promise<Buffer> {
  const handle = await fs.open(path, 'r')
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buf, 0, length, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Stream `src` to `dest`, returning the sha256 of the bytes copied. */
async function copyAndHash(src: string, dest: string): Promise<string> {
  const hash = createHash('sha256')
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    }
  })
  await pipeline(createReadStream(src), tap, createWriteStream(dest))
  return hash.digest('hex')
}

function describeImportError(error: unknown): string {
  if (error instanceof ImportRejectedError) return error.message
  if (isNotFound(error)) return 'File not found.'
  console.error('[media] import failed', error)
  return 'Couldn’t import this file.'
}
