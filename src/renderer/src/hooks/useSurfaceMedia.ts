import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import type { MediaKind } from '@shared/media'
import type { ProjectionEngine } from '../engine/ProjectionEngine'

interface SurfaceMediaOptions {
  /** mirrorcat-media:// URL of the surface's asset, or undefined for none. */
  url: string | undefined
  kind: MediaKind | undefined
  /** Video only: loop, or play once and hold the last frame. */
  loop: boolean
  /** Video only: bumping it restarts playback from the top. */
  playToken: number
  /** False for the editor's handles-only overlay, which shows no content. */
  enabled: boolean
}

/**
 * Loads a surface's image or video into its ProjectionEngine and keeps
 * video playback (loop / once / restart) in step with the surface. Split
 * out of ProjectionCanvas so the canvas is just geometry and handles.
 */
export function useSurfaceMedia(
  engineRef: RefObject<ProjectionEngine | null>,
  { url, kind, loop, playToken, enabled }: SurfaceMediaOptions
): void {
  // Primitives, so a new `media` object with the same content doesn't reload.
  const mediaUrl = url
  const mediaKind = kind
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Read when a video is created, so changing `loop` doesn't reload the
  // file. Kept current by the loop effect below.
  const loopRef = useRef(loop)

  useEffect(() => {
    if (!enabled) return
    if (!mediaUrl) {
      engineRef.current?.setTexture(null)
      return
    }
    let cancelled = false

    if (mediaKind === 'image') {
      new THREE.TextureLoader().load(
        mediaUrl,
        (loaded) => {
          const engine = engineRef.current
          if (cancelled || !engine) {
            loaded.dispose()
            return
          }
          const texture = fitTextureToGpu(loaded, engine.maxTextureSize)
          texture.colorSpace = THREE.SRGBColorSpace
          engine.setTexture(texture)
        },
        undefined,
        () => {
          // File missing from the library (deleted, or userData wiped): fall
          // back to the placeholder fill rather than keeping a stale image.
          if (!cancelled) engineRef.current?.setTexture(null)
        }
      )
      return () => {
        cancelled = true
      }
    }

    // Video: a detached <video> element feeding a VideoTexture. Always
    // muted -- autoplay requires it, and a projection rig shouldn't start
    // making noise unannounced. Each window plays its own copy; the
    // projector's is the one that matters.
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.loop = loopRef.current
    videoRef.current = video

    const handleReady = (): void => {
      const engine = engineRef.current
      if (cancelled || !engine) return
      const texture = new THREE.VideoTexture(video)
      texture.colorSpace = THREE.SRGBColorSpace
      engine.setTexture(texture)
      void video.play().catch(() => undefined)
    }
    const handleError = (): void => {
      if (!cancelled) engineRef.current?.setTexture(null)
    }
    video.addEventListener('loadeddata', handleReady, { once: true })
    video.addEventListener('error', handleError, { once: true })
    video.src = mediaUrl

    return () => {
      cancelled = true
      video.removeEventListener('loadeddata', handleReady)
      video.removeEventListener('error', handleError)
      // Stop decoding and release the file handle; the texture itself is
      // disposed by the engine when the next one replaces it.
      video.pause()
      video.removeAttribute('src')
      video.load()
      if (videoRef.current === video) videoRef.current = null
    }
  }, [mediaUrl, mediaKind, enabled, engineRef])

  // Loop / once, applied live. Turning loop on after a one-shot finished
  // starts it again, which is what you'd expect from the toggle.
  useEffect(() => {
    loopRef.current = loop
    const video = videoRef.current
    if (!video) return
    video.loop = loop
    if (loop && video.ended) void video.play().catch(() => undefined)
  }, [loop])

  // Replay: restart from the top. Skips the first run so mounting doesn't
  // count as a replay.
  const lastPlayToken = useRef(playToken)
  useEffect(() => {
    if (playToken === lastPlayToken.current) return
    lastPlayToken.current = playToken
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    void video.play().catch(() => undefined)
  }, [playToken])
}

/**
 * Phone photos and AI upscales can exceed the GPU's max texture size (often
 * 4096 or 8192px on integrated graphics), which renders as a blank surface.
 * Redraw those onto a canvas that fits. Projectors top out around 4K, so
 * nothing visible is lost.
 */
function fitTextureToGpu(texture: THREE.Texture, maxSize: number): THREE.Texture {
  const image = texture.image as HTMLImageElement
  const longest = Math.max(image.width, image.height)
  if (longest <= maxSize) return texture
  const scale = maxSize / longest
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(image.width * scale))
  canvas.height = Math.max(1, Math.floor(image.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return texture
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  texture.dispose()
  return new THREE.CanvasTexture(canvas)
}
