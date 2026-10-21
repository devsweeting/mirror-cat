/**
 * Media library types, shared by main (which owns the files on disk) and
 * both renderer windows (which only ever see assets by id/URL).
 */

/** Custom protocol the main process serves library files on. */
export const MEDIA_SCHEME = 'mirrorcat-media'

export type MediaSource = 'upload' | 'generated'
export type MediaKind = 'image' | 'video'

/** Image formats Chromium can decode that we accept, mapped to file extension. */
export const ACCEPTED_IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
} as const

/**
 * Video containers we accept. Whether the *codec* inside plays is only known
 * once the renderer tries it (see MediaAsset.playable) -- e.g. a MOV with
 * ProRes won't, a MOV with H.264 will.
 */
export const ACCEPTED_VIDEO_TYPES = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
} as const

export type AcceptedImageType = keyof typeof ACCEPTED_IMAGE_TYPES
export type AcceptedVideoType = keyof typeof ACCEPTED_VIDEO_TYPES
export type AcceptedMediaType = AcceptedImageType | AcceptedVideoType

/** Extensions offered in the file picker. */
export const PICKER_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']
export const PICKER_VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov']

/** Per-file import limits. */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024

/** Asset ids are the sha256 of the file's bytes, so re-importing a file is a no-op. */
export const ASSET_ID_PATTERN = /^[a-f0-9]{64}$/

export interface MediaAsset {
  id: string
  kind: MediaKind
  /** Display name; editable. Defaults to the file name without extension. */
  name: string
  mimeType: AcceptedMediaType
  ext: string
  /** Pixel size. 0 for a video until the renderer has probed it. */
  width: number
  height: number
  bytes: number
  /** Videos only, once probed. */
  durationMs?: number
  /** False once probing showed the file can't be decoded here (e.g. ProRes). */
  playable?: boolean
  /**
   * True once the renderer has measured the file and made a thumbnail.
   * Needed for videos (main can't decode them) and for images nativeImage
   * couldn't thumbnail (WebP/GIF).
   */
  probed?: boolean
  source: MediaSource
  /** The prompt, for generated assets. */
  prompt?: string
  createdAt: number
  /** False when no thumbnail exists yet; the thumb URL then serves the original (images) or 404s (videos). */
  hasThumbnail: boolean
}

/** What the renderer measured about an asset, sent back to main. */
export interface MediaProbeResult {
  width: number
  height: number
  durationMs?: number
  playable: boolean
  /** JPEG poster frame / thumbnail. */
  thumbnail?: Uint8Array
}

export interface MediaImportError {
  /** File name as the user would recognise it. */
  name: string
  message: string
}

export interface MediaImportResult {
  imported: MediaAsset[]
  errors: MediaImportError[]
}

export interface GeneratedImageImport {
  bytes: Uint8Array
  name: string
  prompt?: string
}

/** Full-resolution file, used as the surface texture. */
export function mediaUrl(id: string): string {
  return `${MEDIA_SCHEME}://asset/${id}`
}

/** Small JPEG for the library grid and settings drawer. */
export function thumbnailUrl(id: string): string {
  return `${MEDIA_SCHEME}://thumb/${id}`
}

/** Whether there's something to show in an <img> for this asset. */
export function hasPreview(asset: MediaAsset): boolean {
  return asset.hasThumbnail || asset.kind === 'image'
}

/** Whether the renderer still needs to measure / thumbnail this asset. */
export function needsProbe(asset: MediaAsset): boolean {
  if (asset.probed) return false
  return asset.kind === 'video' || !asset.hasThumbnail
}

/** Short format label for badges: "PNG", "JPG", "MP4", "MOV". */
export function formatLabel(asset: Pick<MediaAsset, 'ext'>): string {
  return asset.ext.toUpperCase()
}

/** "0:07", "2:15", "1:02:03". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
