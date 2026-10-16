import { mediaUrl, needsProbe, type MediaAsset, type MediaProbeResult } from '@shared/media'

/** Longest side of a thumbnail / poster frame, in pixels. */
const THUMB_MAX = 320
/** Give up on a file that hasn't produced a frame by then. */
const PROBE_TIMEOUT_MS = 20_000

const started = new Set<string>()
let queue: Promise<void> = Promise.resolve()

/**
 * Measure and thumbnail any assets the main process couldn't: every video
 * (main has no video decoder) and images nativeImage can't read (WebP,
 * GIF). Runs one at a time in the control window only, and reports back
 * via media.attachProbe, which marks the asset probed for good.
 */
export function probePendingAssets(assets: MediaAsset[]): void {
  for (const asset of assets) {
    if (!needsProbe(asset) || started.has(asset.id)) continue
    started.add(asset.id)
    queue = queue
      .then(() => probeAsset(asset))
      .then((result) => window.mirrorcat.media.attachProbe(asset.id, result))
      .then(() => undefined)
      .catch((error) => console.error(`[media] probe failed for ${asset.id}`, error))
  }
}

function probeAsset(asset: MediaAsset): Promise<MediaProbeResult> {
  return asset.kind === 'video' ? probeVideo(mediaUrl(asset.id)) : probeImage(mediaUrl(asset.id))
}

const UNPLAYABLE: MediaProbeResult = { width: 0, height: 0, playable: false }

function probeVideo(url: string): Promise<MediaProbeResult> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'

    let settled = false
    const finish = (result: MediaProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Release the decoder straight away.
      video.removeAttribute('src')
      video.load()
      resolve(result)
    }
    const timer = setTimeout(() => finish(UNPLAYABLE), PROBE_TIMEOUT_MS)

    // Fires for unsupported codecs (e.g. ProRes, some HEVC) as well as broken files.
    video.addEventListener('error', () => finish(UNPLAYABLE))

    video.addEventListener('loadedmetadata', () => {
      // Audio-only file in a video container.
      if (!video.videoWidth || !video.videoHeight) {
        finish(UNPLAYABLE)
        return
      }
      // Poster frame from a little way in: frame 0 is often black.
      const d = video.duration
      video.currentTime = Number.isFinite(d) && d > 0 ? Math.min(1, d * 0.1) : 0.001
    })

    video.addEventListener(
      'seeked',
      () => {
        const width = video.videoWidth
        const height = video.videoHeight
        const durationMs = Number.isFinite(video.duration)
          ? Math.round(video.duration * 1000)
          : undefined
        void encodeThumbnail(video, width, height).then((thumbnail) =>
          finish({ width, height, durationMs, playable: true, thumbnail })
        )
      },
      { once: true }
    )

    video.src = url
  })
}

async function probeImage(url: string): Promise<MediaProbeResult> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  try {
    await img.decode()
  } catch {
    return UNPLAYABLE
  }
  const thumbnail = await encodeThumbnail(img, img.naturalWidth, img.naturalHeight)
  return { width: img.naturalWidth, height: img.naturalHeight, playable: true, thumbnail }
}

async function encodeThumbnail(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<Uint8Array | undefined> {
  if (!width || !height) return undefined
  const scale = Math.min(1, THUMB_MAX / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.82)
  )
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
}
