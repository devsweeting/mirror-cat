import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateSync } from 'zlib'
import { MaskStore } from './maskStore'

/** A minimal valid PNG of the given size (gray, one row of zero bytes each). */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  const raw = Buffer.alloc((width + 1) * height)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function crc32(buf: Buffer): number {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

let dir: string
let store: MaskStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mirrorcat-masks-'))
  store = new MaskStore(join(dir, 'masks'))
  await store.init()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('MaskStore', () => {
  it('stores a PNG under its sha256 and finds it again', async () => {
    const id = await store.save(png(4, 3))
    expect(id).toMatch(/^[a-f0-9]{64}$/)
    expect(await store.has(id)).toBe(true)
    expect(await store.save(png(4, 3))).toBe(id) // same bytes, same id
    expect(await readdir(join(dir, 'masks'))).toEqual([`${id}.png`])
  })

  it('rejects non-PNG, empty and oversized masks', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(0)])
    await expect(store.save(jpeg)).rejects.toThrow()
    await expect(store.save(Buffer.alloc(0))).rejects.toThrow()
    await expect(store.save(Buffer.from('not an image at all'))).rejects.toThrow()
    await expect(store.save(png(5000, 10))).rejects.toThrow(/at most/)
  })

  it('never resolves ids that could escape the folder', async () => {
    expect(await store.has('../scene')).toBe(false)
    expect(() => store.pathFor('../../etc/passwd')).toThrow()
  })

  it('sweeps masks no scene uses, and stray temp files', async () => {
    const keep = await store.save(png(2, 2))
    const drop = await store.save(png(3, 3))
    await writeFile(join(dir, 'masks', `${keep}.png.abc123.tmp`), 'partial')
    expect(await store.sweep(new Set([keep]))).toBe(2)
    expect(await store.has(keep)).toBe(true)
    expect(await store.has(drop)).toBe(false)
    expect(await readdir(join(dir, 'masks'))).toEqual([`${keep}.png`])
  })
})
