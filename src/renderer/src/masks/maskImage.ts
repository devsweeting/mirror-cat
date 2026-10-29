import * as THREE from 'three'
import {
  MASK_UPLOAD_EDGE,
  encodeSignedDistanceField,
  fieldSize,
  maskGrayFromRgba,
  maskUrl
} from '@shared/mask'
import { mediaUrl } from '@shared/media'

export interface MaskField {
  data: Uint8Array
  width: number
  height: number
}

/**
 * Distance fields by mask id. Computing one takes ~50–100 ms at 1024 px, and
 * both the editor and the projector (and undo/redo of a paint session's
 * saves) ask for the same few masks again and again. Ids are content
 * hashes, so a cached field is never stale.
 */
const fieldCache = new Map<string, Promise<MaskField>>()
const FIELD_CACHE_SIZE = 12

export function loadMaskField(id: string): Promise<MaskField> {
  const cached = fieldCache.get(id)
  if (cached) {
    // Refresh its spot so the least recently used one is evicted first.
    fieldCache.delete(id)
    fieldCache.set(id, cached)
    return cached
  }
  const loading = loadImage(maskUrl(id)).then((image) => {
    const { width, height } = fieldSize(image.naturalWidth, image.naturalHeight)
    const rgba = drawToPixels(image, width, height)
    return { data: encodeSignedDistanceField(maskGrayFromRgba(rgba), width, height), width, height }
  })
  fieldCache.set(id, loading)
  loading.catch(() => fieldCache.delete(id))
  while (fieldCache.size > FIELD_CACHE_SIZE) {
    fieldCache.delete(fieldCache.keys().next().value as string)
  }
  return loading
}

/** One-channel texture for the engine's mask shader. Rows run top-down. */
export function fieldTexture({ data, width, height }: MaskField): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType)
  configureMaskTexture(texture)
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

/** Shared settings for every mask texture: smooth, no mipmaps, data not color. */
export function configureMaskTexture(texture: THREE.Texture): void {
  texture.flipY = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.colorSpace = THREE.NoColorSpace
}

/**
 * Turn any image (an upload, or the surface's own picture) into a mask
 * PNG: grayscale, opaque, at most MASK_UPLOAD_EDGE on its longest side.
 * Transparent images use their alpha (cut-outs), opaque ones their
 * brightness -- see maskGrayFromRgba.
 */
export async function imageToMaskPng(blob: Blob): Promise<Uint8Array> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('That file isn’t an image MirrorCat can read. Use PNG, JPEG or WebP.')
  }
  try {
    const scale = Math.min(1, MASK_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const rgba = drawToPixels(bitmap, width, height)
    const gray = maskGrayFromRgba(rgba)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const out = ctx.createImageData(width, height)
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4
      out.data[o] = out.data[o + 1] = out.data[o + 2] = gray[i]
      out.data[o + 3] = 255
    }
    ctx.putImageData(out, 0, 0)
    return canvasToPng(canvas)
  } finally {
    bitmap.close()
  }
}

/**
 * Store a mask PNG through main. In `npm run dev`, editing the preload or
 * main process doesn't hot-reload them -- only the page -- so a new UI can
 * meet an old bridge. Say that plainly instead of "cannot read properties
 * of undefined".
 */
export function saveMaskPng(png: Uint8Array): Promise<string> {
  const masks = window.mirrorcat.masks as typeof window.mirrorcat.masks | undefined
  if (!masks) {
    return Promise.reject(
      new Error('MirrorCat needs a restart to finish updating (quit and reopen it), then try again.')
    )
  }
  return masks.save(png)
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Couldn’t encode the mask')
  return new Uint8Array(await blob.arrayBuffer())
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.src = url
  return image.decode().then(() => image)
}

function drawToPixels(source: CanvasImageSource, width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}

const transparencyCache = new Map<string, Promise<boolean>>()

/**
 * Whether a library image has a meaningful transparent area (a cut-out),
 * checked on a small copy. Cached by asset id -- ids are content hashes.
 * Formats that can't carry alpha answer false without loading.
 */
export function imageHasTransparency(id: string, mimeType: string): Promise<boolean> {
  if (!/png|webp|gif/.test(mimeType)) return Promise.resolve(false)
  let cached = transparencyCache.get(id)
  if (!cached) {
    cached = loadImage(mediaUrl(id))
      .then((image) => {
        const { width, height } = fieldSize(image.naturalWidth, image.naturalHeight, 128)
        const rgba = drawToPixels(image, width, height)
        let clear = 0
        for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 128) clear++
        // At least 2% transparent: a cut-out, not a stray edge pixel.
        return clear > (rgba.length / 4) * 0.02
      })
      .catch(() => false)
    transparencyCache.set(id, cached)
  }
  return cached
}
