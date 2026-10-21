import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  type AcceptedImageType,
  type AcceptedVideoType
} from '../../shared/media'

/** How many leading bytes sniffMedia needs. */
export const SNIFF_BYTES = 256

export type SniffedMedia =
  { kind: 'image' } | { kind: 'video'; mimeType: AcceptedVideoType; ext: string }

/**
 * Decide image vs video (vs reject) from a file's first bytes, so a video
 * can be streamed into the library without ever being read into memory.
 * Images still go through readImageInfo on the full buffer afterwards.
 */
export function sniffMedia(head: Buffer): SniffedMedia {
  if (isImageSignature(head)) return { kind: 'image' }
  if (isHeifFamily(head)) {
    throw new ImportRejectedError(
      'HEIC/AVIF photos aren’t supported yet. Export it as JPEG or PNG and try again.'
    )
  }

  // ISO base media (MP4, M4V, MOV): an 'ftyp' box first, whose brand says which.
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') {
    const brand = head.toString('ascii', 8, 12)
    if (brand === 'qt  ') return video('video/quicktime')
    if (brand.startsWith('M4A') || brand === 'M4B ' || brand === 'M4P ') {
      throw new ImportRejectedError('Audio files can’t be projected. Use a video or image.')
    }
    return video('video/mp4')
  }
  // Older QuickTime files can start straight with another top-level atom.
  if (
    head.length >= 8 &&
    ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(head.toString('ascii', 4, 8))
  ) {
    return video('video/quicktime')
  }

  // Matroska family (EBML header). Chromium plays WebM; general MKV isn't supported.
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) {
    if (head.includes('webm', 0, 'ascii')) return video('video/webm')
    throw new ImportRejectedError('MKV files aren’t supported. Convert it to MP4 (H.264) or WebM.')
  }

  throw new ImportRejectedError(
    'Not a supported file. Use an image (PNG, JPEG, WebP, GIF) or a video (MP4, MOV, WebM).'
  )
}

function video(mimeType: AcceptedVideoType): SniffedMedia {
  return { kind: 'video', mimeType, ext: ACCEPTED_VIDEO_TYPES[mimeType] }
}

function isImageSignature(buf: Buffer): boolean {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return true
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return true
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
  return (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
}

export interface ImageInfo {
  mimeType: AcceptedImageType
  ext: string
  width: number
  height: number
}

/** An import the user should see a friendly reason for. */
export class ImportRejectedError extends Error {}

/**
 * Identify an image by its bytes (never by its file extension, which lies
 * often enough -- e.g. a .jpg that's really a HEIC from an iPhone) and read
 * its pixel size from the header without decoding it.
 */
export function readImageInfo(buf: Buffer): ImageInfo {
  const info = readPng(buf) ?? readGif(buf) ?? readJpeg(buf) ?? readWebp(buf)
  if (info) {
    if (info.width <= 0 || info.height <= 0) {
      throw new ImportRejectedError("Couldn't read the image size. The file may be damaged.")
    }
    return info
  }
  if (isHeifFamily(buf)) {
    throw new ImportRejectedError(
      'HEIC/AVIF photos aren’t supported yet. Export it as JPEG or PNG and try again.'
    )
  }
  throw new ImportRejectedError('Not a supported image. Use PNG, JPEG, WebP or GIF.')
}

function make(mimeType: AcceptedImageType, width: number, height: number): ImageInfo {
  return { mimeType, ext: ACCEPTED_IMAGE_TYPES[mimeType], width, height }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readPng(buf: Buffer): ImageInfo | null {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  return make('image/png', buf.readUInt32BE(16), buf.readUInt32BE(20))
}

function readGif(buf: Buffer): ImageInfo | null {
  if (buf.length < 10) return null
  const sig = buf.toString('ascii', 0, 6)
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null
  return make('image/gif', buf.readUInt16LE(6), buf.readUInt16LE(8))
}

function readJpeg(buf: Buffer): ImageInfo | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = buf[offset + 1]
    // Fill bytes and standalone markers (RSTn, SOI, EOI, TEM) carry no length.
    if (marker === 0xff) {
      offset++
      continue
    }
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      offset += 2
      continue
    }
    const length = buf.readUInt16BE(offset + 2)
    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC), hold the frame size.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isFrame) {
      return make('image/jpeg', buf.readUInt16BE(offset + 7), buf.readUInt16BE(offset + 5))
    }
    offset += 2 + length
  }
  // A JPEG we couldn't find a frame header in is still a JPEG -- report it
  // as damaged rather than "unsupported".
  return make('image/jpeg', 0, 0)
}

function readWebp(buf: Buffer): ImageInfo | null {
  if (buf.length < 30) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunk = buf.toString('ascii', 12, 16)
  if (chunk === 'VP8 ') {
    return make('image/webp', buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff)
  }
  if (chunk === 'VP8L') {
    const b0 = buf[21]
    const b1 = buf[22]
    const b2 = buf[23]
    const b3 = buf[24]
    const width = 1 + (((b1 & 0x3f) << 8) | b0)
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    return make('image/webp', width, height)
  }
  if (chunk === 'VP8X') {
    return make('image/webp', 1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3))
  }
  return make('image/webp', 0, 0)
}

function isHeifFamily(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false
  const brand = buf.toString('ascii', 8, 12)
  return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis'].includes(brand)
}
