// Minimal, valid-enough file headers for tests. Only the bytes the
// sniffer and size readers look at are real; the rest is padding.

export function png(width: number, height: number, padTo = 64): Buffer {
  const buf = Buffer.alloc(Math.max(padTo, 24))
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

export function gif(width: number, height: number): Buffer {
  const buf = Buffer.alloc(32)
  buf.write('GIF89a', 0, 'ascii')
  buf.writeUInt16LE(width, 6)
  buf.writeUInt16LE(height, 8)
  return buf
}

/** SOI, an APP0 segment to skip over, then a baseline SOF0 frame header. */
export function jpeg(width: number, height: number, { withFrame = true } = {}): Buffer {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)])
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    ...Array(12).fill(0)
  ])
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    withFrame ? sof : Buffer.alloc(0),
    Buffer.alloc(16)
  ])
}

export function webpVp8x(width: number, height: number): Buffer {
  const buf = Buffer.alloc(40)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(32, 4)
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8X', 12, 'ascii')
  buf.writeUIntLE(width - 1, 24, 3)
  buf.writeUIntLE(height - 1, 27, 3)
  return buf
}

export function webpVp8l(width: number, height: number): Buffer {
  const buf = Buffer.alloc(40)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(32, 4)
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8L', 12, 'ascii')
  buf[20] = 0x2f
  const w = width - 1
  const h = height - 1
  buf[21] = w & 0xff
  buf[22] = ((w >> 8) & 0x3f) | ((h & 0x3) << 6)
  buf[23] = (h >> 2) & 0xff
  buf[24] = (h >> 10) & 0x0f
  return buf
}

/** ISO base media file with the given major brand ('isom', 'qt  ', 'heic', 'M4A '...). */
export function ftyp(brand: string, padTo = 512): Buffer {
  const buf = Buffer.alloc(padTo)
  buf.writeUInt32BE(24, 0)
  buf.write('ftyp', 4, 'ascii')
  buf.write(brand.padEnd(4, ' ').slice(0, 4), 8, 'ascii')
  return buf
}

export function ebml(docType: 'webm' | 'matroska'): Buffer {
  const buf = Buffer.alloc(64)
  buf.writeUInt32BE(0x1a45dfa3, 0)
  buf.write(docType, 8, 'ascii')
  return buf
}

/** Smallest thing attachProbe accepts as a JPEG thumbnail. */
export function jpegThumb(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00])
}
