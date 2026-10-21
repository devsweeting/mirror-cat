import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ftyp, jpegThumb, png } from '../testUtil/mediaFixtures'

// nativeImage only exists inside Electron. Report every image as
// undecodable, which is the path WebP/GIF take in the real app (the
// renderer probe makes their thumbnails instead).
vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }
}))

const { MediaLibrary } = await import('./mediaLibrary')

let root: string
let library: InstanceType<typeof MediaLibrary>

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'mirrorcat-media-'))
  library = new MediaLibrary(root)
  await library.init()
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')

async function writeSource(name: string, data: Buffer | string): Promise<string> {
  const path = join(root, 'source', name)
  await fs.mkdir(join(root, 'source'), { recursive: true })
  await fs.writeFile(path, data)
  return path
}

async function readIndex() {
  return JSON.parse(await fs.readFile(join(root, 'library.json'), 'utf8'))
}

describe('importing', () => {
  it('stores an image under its content hash and indexes it', async () => {
    const bytes = png(800, 600)
    const asset = await library.importBuffer(bytes, { name: '  My   photo ', source: 'upload' })
    expect(asset).toMatchObject({
      id: sha(bytes),
      kind: 'image',
      name: 'My photo',
      mimeType: 'image/png',
      ext: 'png',
      width: 800,
      height: 600,
      hasThumbnail: false,
      probed: false
    })
    expect(await fs.readFile(library.filePath(asset))).toEqual(bytes)
    expect((await readIndex()).assets).toHaveLength(1)
  })

  it('deduplicates identical bytes', async () => {
    const bytes = png(10, 10)
    const a = await library.importBuffer(bytes, { name: 'a', source: 'upload' })
    const b = await library.importBuffer(Buffer.from(bytes), { name: 'b', source: 'generated' })
    expect(b).toBe(a)
    expect(library.list()).toHaveLength(1)
  })

  it('keeps every asset when imports overlap', async () => {
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        library.importBuffer(png(n, n), { name: `${n}`, source: 'upload' })
      )
    )
    expect(library.list()).toHaveLength(5)
    expect((await readIndex()).assets).toHaveLength(5)
  })

  it('notifies listeners with the full list', async () => {
    const seen: number[] = []
    library.onChange((assets) => seen.push(assets.length))
    await library.importBuffer(png(1, 1), { name: 'x', source: 'upload' })
    expect(seen).toEqual([1])
  })

  it('imports files from disk and explains every rejection', async () => {
    const good = await writeSource('wall.png', png(64, 32))
    const folder = join(root, 'source', 'a-folder')
    await fs.mkdir(folder, { recursive: true })
    const empty = await writeSource('empty.png', '')
    const text = await writeSource('notes.png', 'definitely not a png')
    const missing = join(root, 'source', 'gone.png')

    const result = await library.importPaths([good, folder, empty, text, missing])
    expect(result.imported.map((a) => a.name)).toEqual(['wall'])
    expect(result.errors.map((e) => [e.name, e.message])).toEqual([
      ['a-folder', 'Folders can’t be imported.'],
      ['empty.png', 'The file is empty.'],
      ['notes.png', expect.stringMatching(/Not a supported file/)],
      ['gone.png', 'File not found.']
    ])
  })

  it('streams videos in and names them by content hash', async () => {
    const bytes = ftyp('isom', 4096)
    const path = await writeSource('clip.mov', bytes)
    const { imported } = await library.importPaths([path])
    expect(imported[0]).toMatchObject({
      id: sha(bytes),
      kind: 'video',
      mimeType: 'video/mp4',
      ext: 'mp4',
      bytes: 4096,
      probed: false
    })
    expect(await fs.readFile(library.filePath(imported[0]))).toEqual(bytes)
    // No temp files left behind.
    expect((await fs.readdir(join(root, 'files'))).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('editing', () => {
  it('renames, trimming and capping the name; ignores blank names', async () => {
    const asset = await library.importBuffer(png(1, 1), { name: 'a', source: 'upload' })
    expect((await library.rename(asset.id, '  New\tname  '))?.name).toBe('New name')
    expect((await library.rename(asset.id, '   '))?.name).toBe('New name')
    expect((await library.rename(asset.id, 'x'.repeat(200)))?.name).toHaveLength(80)
    expect(await library.rename('f'.repeat(64), 'nope')).toBeNull()
  })

  it('stores what the renderer measured, accepting only JPEG thumbnails', async () => {
    const video = (await library.importPaths([await writeSource('v.mp4', ftyp('isom'))]))
      .imported[0]

    const notJpeg = await library.attachProbe(video.id, {
      width: 1920,
      height: 1080,
      durationMs: 7_000,
      playable: true,
      thumbnail: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    })
    expect(notJpeg).toMatchObject({ width: 1920, height: 1080, durationMs: 7000, playable: true })
    expect(notJpeg?.hasThumbnail).toBe(false)

    const withThumb = await library.attachProbe(video.id, {
      width: -1,
      height: Infinity,
      playable: true,
      thumbnail: jpegThumb()
    })
    expect(withThumb).toMatchObject({ width: 1920, height: 1080, hasThumbnail: true, probed: true })
    await expect(fs.access(library.thumbPath(video))).resolves.toBeUndefined()
  })

  it('marks videos the renderer could not decode as unplayable', async () => {
    const video = (await library.importPaths([await writeSource('p.mov', ftyp('qt  '))]))
      .imported[0]
    const probed = await library.attachProbe(video.id, { width: 0, height: 0, playable: false })
    expect(probed?.playable).toBe(false)
  })

  it('removes the index entry and both files', async () => {
    const asset = await library.importBuffer(png(1, 1), { name: 'a', source: 'upload' })
    await library.attachProbe(asset.id, {
      width: 1,
      height: 1,
      playable: true,
      thumbnail: jpegThumb()
    })
    expect(await library.remove(asset.id)).toBe(true)
    expect(library.get(asset.id)).toBeUndefined()
    await expect(fs.access(library.filePath(asset))).rejects.toThrow()
    await expect(fs.access(library.thumbPath(asset))).rejects.toThrow()
    expect(await library.remove(asset.id)).toBe(false)
  })
})

describe('start-up', () => {
  it('reloads the index', async () => {
    await library.importBuffer(png(5, 5), { name: 'kept', source: 'upload' })
    const reopened = new MediaLibrary(root)
    await reopened.init()
    expect(reopened.list().map((a) => a.name)).toEqual(['kept'])
  })

  it('sweeps orphaned files and temp files, keeping indexed ones', async () => {
    const kept = await library.importBuffer(png(5, 5), { name: 'kept', source: 'upload' })
    const orphan = join(root, 'files', `${'e'.repeat(64)}.png`)
    const orphanThumb = join(root, 'thumbs', `${'e'.repeat(64)}.jpg`)
    const tmp = join(root, 'files', '.import-abc123.tmp')
    const unrelated = join(root, 'files', 'README.txt')
    for (const f of [orphan, orphanThumb, tmp, unrelated]) await fs.writeFile(f, 'x')

    await new MediaLibrary(root).init()
    const files = await fs.readdir(join(root, 'files'))
    expect(files.sort()).toEqual([`${kept.id}.png`, 'README.txt'].sort())
    expect(await fs.readdir(join(root, 'thumbs'))).toEqual([])
  })

  it('quarantines an unreadable index and does not sweep (every file would look orphaned)', async () => {
    const asset = await library.importBuffer(png(5, 5), { name: 'a', source: 'upload' })
    await fs.writeFile(join(root, 'library.json'), '{ broken')
    const reopened = new MediaLibrary(root)
    await reopened.init()
    expect(reopened.list()).toEqual([])
    await expect(fs.access(library.filePath(asset))).resolves.toBeUndefined()
    expect((await fs.readdir(root)).some((f) => f.startsWith('library.json.corrupt-'))).toBe(true)
  })

  it('ignores index entries with invalid ids', async () => {
    await fs.writeFile(
      join(root, 'library.json'),
      JSON.stringify({ version: 1, assets: [{ id: '../../etc/passwd' }, { id: 42 }, null] })
    )
    const reopened = new MediaLibrary(root)
    await reopened.init()
    expect(reopened.list()).toEqual([])
  })
})

describe('normalizeAsset', () => {
  const valid = {
    id: 'c'.repeat(64),
    kind: 'image',
    name: 'Wall',
    mimeType: 'image/jpeg',
    ext: 'jpg',
    width: 10,
    height: 20,
    bytes: 300,
    source: 'upload',
    createdAt: 5,
    hasThumbnail: true,
    probed: true
  }

  it('accepts a well-formed entry unchanged', async () => {
    const { normalizeAsset } = await import('./mediaLibrary')
    expect(normalizeAsset(valid)).toEqual(valid)
  })

  it('rejects a type we do not serve, or an extension that does not match it', async () => {
    const { normalizeAsset } = await import('./mediaLibrary')
    expect(normalizeAsset({ ...valid, mimeType: 'text/html', ext: 'html' })).toBeNull()
    expect(normalizeAsset({ ...valid, ext: '../../../evil' })).toBeNull()
    expect(normalizeAsset({ ...valid, ext: 'png' })).toBeNull()
  })

  it('derives kind from the type for entries written before video support', async () => {
    const { normalizeAsset } = await import('./mediaLibrary')
    const legacy = { ...valid, kind: undefined, mimeType: 'video/quicktime', ext: 'mov' }
    expect(normalizeAsset(legacy)?.kind).toBe('video')
  })

  it('cleans up junk values instead of trusting them', async () => {
    const { normalizeAsset } = await import('./mediaLibrary')
    const asset = normalizeAsset({ ...valid, width: -4, bytes: 'lots', source: 'admin', name: 7 })
    expect(asset).toMatchObject({ width: 0, bytes: 0, source: 'upload', name: 'Untitled' })
  })
})
