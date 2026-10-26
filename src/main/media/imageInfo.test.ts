import { describe, expect, it } from 'vitest'
import { ImportRejectedError, readImageInfo, sniffMedia } from './imageInfo'
import { ebml, ftyp, gif, jpeg, png, webpVp8l, webpVp8x } from '../testUtil/mediaFixtures'

describe('readImageInfo', () => {
  it.each([
    ['PNG', png(1920, 1080), 'image/png', 'png'],
    ['GIF', gif(320, 240), 'image/gif', 'gif'],
    ['JPEG', jpeg(4032, 3024), 'image/jpeg', 'jpg'],
    ['WebP (VP8X)', webpVp8x(5000, 2000), 'image/webp', 'webp'],
    ['WebP (VP8L)', webpVp8l(1000, 700), 'image/webp', 'webp']
  ])('reads %s type and size from the header', (_label, buf, mimeType, ext) => {
    const info = readImageInfo(buf)
    expect(info.mimeType).toBe(mimeType)
    expect(info.ext).toBe(ext)
    expect(info.width).toBeGreaterThan(0)
  })

  it('gets the exact dimensions right', () => {
    expect(readImageInfo(png(1920, 1080))).toMatchObject({ width: 1920, height: 1080 })
    expect(readImageInfo(jpeg(4032, 3024))).toMatchObject({ width: 4032, height: 3024 })
    expect(readImageInfo(webpVp8l(1000, 700))).toMatchObject({ width: 1000, height: 700 })
    expect(readImageInfo(webpVp8x(5000, 2000))).toMatchObject({ width: 5000, height: 2000 })
  })

  it('reports a JPEG with no frame header as damaged, not unsupported', () => {
    expect(() => readImageInfo(jpeg(10, 10, { withFrame: false }))).toThrow(/damaged/)
  })

  it('rejects HEIC/AVIF with a helpful message', () => {
    expect(() => readImageInfo(ftyp('heic'))).toThrow(/HEIC/)
    expect(() => readImageInfo(ftyp('avif'))).toThrow(/HEIC\/AVIF/)
  })

  it('rejects zero-size images and unknown bytes', () => {
    expect(() => readImageInfo(png(0, 100))).toThrow(ImportRejectedError)
    expect(() => readImageInfo(Buffer.from('hello world, not an image'))).toThrow(
      ImportRejectedError
    )
    expect(() => readImageInfo(Buffer.alloc(0))).toThrow(ImportRejectedError)
  })
})

describe('sniffMedia', () => {
  it.each([
    ['MP4', ftyp('isom'), 'video/mp4', 'mp4'],
    ['M4V', ftyp('M4V '), 'video/mp4', 'mp4'],
    ['QuickTime', ftyp('qt  '), 'video/quicktime', 'mov'],
    ['WebM', ebml('webm'), 'video/webm', 'webm']
  ])('recognises %s as video', (_label, head, mimeType, ext) => {
    expect(sniffMedia(head)).toEqual({ kind: 'video', mimeType, ext })
  })

  it('recognises old QuickTime files that start with another atom', () => {
    const head = Buffer.alloc(64)
    head.write('moov', 4, 'ascii')
    expect(sniffMedia(head)).toMatchObject({ kind: 'video', mimeType: 'video/quicktime' })
  })

  it('sends images to readImageInfo', () => {
    for (const head of [png(1, 1), gif(1, 1), jpeg(1, 1), webpVp8x(1, 1)]) {
      expect(sniffMedia(head)).toEqual({ kind: 'image' })
    }
  })

  it('rejects audio, MKV, HEIC and everything else with a reason', () => {
    expect(() => sniffMedia(ftyp('M4A '))).toThrow(/Audio/)
    expect(() => sniffMedia(ebml('matroska'))).toThrow(/MKV/)
    expect(() => sniffMedia(ftyp('heic'))).toThrow(/HEIC/)
    expect(() => sniffMedia(Buffer.from('%PDF-1.7'))).toThrow(/Not a supported file/)
    expect(() => sniffMedia(Buffer.alloc(0))).toThrow(ImportRejectedError)
  })
})

describe('parsers on hostile input', () => {
  // Imports are untrusted bytes. Whatever arrives, the only acceptable
  // failure is a friendly ImportRejectedError -- never a RangeError from
  // reading past the end of a buffer, and never a hang.
  const prefixes = [
    Buffer.alloc(0),
    png(1, 1).subarray(0, 8),
    Buffer.from([0xff, 0xd8]),
    Buffer.from('GIF89a'),
    Buffer.from('RIFF\0\0\0\0WEBPVP8 '),
    Buffer.from('RIFF\0\0\0\0WEBPVP8X'),
    Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
  ]

  // Small deterministic PRNG so failures are reproducible.
  let seed = 0x2f6b
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

  it('only ever throws ImportRejectedError', () => {
    for (let round = 0; round < 2000; round++) {
      const prefix = prefixes[round % prefixes.length]
      const tail = Buffer.alloc(Math.floor(rand() * 64))
      for (let k = 0; k < tail.length; k++) tail[k] = Math.floor(rand() * 256)
      const buf = Buffer.concat([prefix, tail])
      for (const fn of [readImageInfo, sniffMedia]) {
        try {
          fn(buf)
        } catch (error) {
          expect(error, `input ${buf.toString('hex')}`).toBeInstanceOf(ImportRejectedError)
        }
      }
    }
  })
})
