import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from 'react'
import * as THREE from 'three'
import { ProjectionEngine } from '../engine/ProjectionEngine'
import type { EdgeNodeSet, Surface } from '@shared/types'
import type { MediaKind } from '@shared/media'
import {
  boundaryPoints,
  insertEdgeNode,
  moveEdgeNode,
  removeEdgeNode
} from '@shared/surfaceGeometry'
import {
  applyEdgeNodeFrames,
  aspectLabel,
  captureEdgeNodeFrames,
  cornersAspect,
  proportionalCorners,
  type EdgeNodeFrames
} from '@shared/proportionalResize'
import { beginShapeGesture, endShapeGesture } from '../state/shapeHistory'

interface ProjectionCanvasProps {
  surface: Surface
  /**
   * What to show: a mirrorcat-media:// URL, whether it's an image or a
   * video, and its width/height ratio (used by Shift-drag) once known.
   */
  media?: { url: string; kind: MediaKind; aspect?: number }
  /** Show the outline, corner targets and edge nodes (control window only). */
  editable?: boolean
  /** Show a dimmed outline with no handles -- other visible surfaces in the editor. */
  ghost?: boolean
  /**
   * Overlay only: outline and handles, no WebGL and no media playback. The
   * editor draws the selected surface's content in its real stacking slot
   * and this overlay on top, so its handles stay reachable without lifting
   * its content above surfaces that are in front of it.
   */
  contentless?: boolean
  onCornersChange?: (corners: Surface['corners']) => void
  onEdgeNodesChange?: (edgeNodes: EdgeNodeSet) => void
}

const CORNER_LABELS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const
const EDGE_LABELS = ['top', 'right', 'bottom', 'left'] as const

type DragTarget = { kind: 'corner'; index: number } | { kind: 'node'; id: string }

interface DragState {
  target: DragTarget
  /** Pointer position minus target position at grab time, in container pixels. */
  offsetX: number
  offsetY: number
  /** Set while Shift is held on a corner drag (see proportionalResize.ts). */
  proportional?: {
    anchor: { x: number; y: number }
    aspect: number
    frames: EdgeNodeFrames
  }
}

export default function ProjectionCanvas({
  surface,
  media,
  editable = false,
  ghost = false,
  contentless = false,
  onCornersChange,
  onEdgeNodesChange
}: ProjectionCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<ProjectionEngine | null>(null)
  // A ref, not state: pointermove fires far more often than React needs to
  // know about, and the grab offset never affects what's rendered.
  const dragRef = useRef<DragState | null>(null)
  // Shown next to the dragged corner while Shift is locking proportions.
  const [lockHint, setLockHint] = useState<{ index: number; label: string } | null>(null)

  useEffect(() => {
    if (!containerRef.current || contentless) return
    const engine = new ProjectionEngine(containerRef.current, surface.corners, surface.edgeNodes)
    engineRef.current = engine
    return () => engine.dispose()
    // Only re-create the engine when the container mounts; shape/texture
    // updates are pushed imperatively below instead of re-mounting Three.js.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    engineRef.current?.setShape(surface.corners, surface.edgeNodes)
  }, [surface.corners, surface.edgeNodes])

  useEffect(() => {
    engineRef.current?.setOpacity(surface.opacity)
  }, [surface.opacity])

  useEffect(() => {
    engineRef.current?.setFit(surface.fit)
  }, [surface.fit])

  // Primitives, so a new `media` object with the same content doesn't reload.
  const mediaUrl = media?.url
  const mediaKind = media?.kind
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Read when a video is created, so changing `loop` doesn't reload the
  // file. Kept current by the loop effect below.
  const loopRef = useRef(surface.loop)

  useEffect(() => {
    if (contentless) return
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
  }, [mediaUrl, mediaKind, contentless])

  const mediaAspect = media?.aspect

  // Loop / once, applied live. Turning loop on after a one-shot finished
  // starts it again, which is what you'd expect from the toggle.
  useEffect(() => {
    loopRef.current = surface.loop
    const video = videoRef.current
    if (!video) return
    video.loop = surface.loop
    if (surface.loop && video.ended) void video.play().catch(() => undefined)
  }, [surface.loop])

  // Replay: restart from the top. Skips the first run so mounting doesn't
  // count as a replay.
  const lastPlayToken = useRef(surface.playToken)
  useEffect(() => {
    if (surface.playToken === lastPlayToken.current) return
    lastPlayToken.current = surface.playToken
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    void video.play().catch(() => undefined)
  }, [surface.playToken])

  const outline = useMemo(
    () => boundaryPoints(surface.corners, surface.edgeNodes),
    [surface.corners, surface.edgeNodes]
  )
  const points = outline.map((p) => `${p.x},${p.y}`).join(' ')

  /**
   * Pointer position in the container's content box (where the canvas,
   * outline and handles are all laid out), excluding its border.
   */
  const toLocal = useCallback((event: PointerEvent<HTMLElement> | MouseEvent<Element>) => {
    const el = containerRef.current!
    const rect = el.getBoundingClientRect()
    return {
      x: event.clientX - rect.left - el.clientLeft,
      y: event.clientY - rect.top - el.clientTop,
      width: el.clientWidth,
      height: el.clientHeight
    }
  }, [])

  const startDrag = useCallback(
    (target: DragTarget, at: { x: number; y: number }) => (event: PointerEvent<HTMLDivElement>) => {
      if (!containerRef.current || event.button !== 0) return
      event.preventDefault()
      // preventDefault suppresses the focus a click would normally give;
      // focus explicitly so a grabbed node is "selected" for Delete.
      event.currentTarget.focus()
      const p = toLocal(event)
      // Keep the grab offset so the point doesn't jump to the cursor when
      // you grab the outer ring of a target rather than its exact center.
      beginShapeGesture(surface.id)
      dragRef.current = {
        target,
        offsetX: p.x - at.x * p.width,
        offsetY: p.y - at.y * p.height
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [surface.id, toLocal]
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || !containerRef.current) return
      const p = toLocal(event)
      if (p.width === 0 || p.height === 0) return
      const x = clamp01((p.x - drag.offsetX) / p.width)
      const y = clamp01((p.y - drag.offsetY) / p.height)
      if (drag.target.kind === 'corner') {
        const index = drag.target.index

        // Shift: lock to an upright rectangle in the media's proportions,
        // anchored at the opposite corner, so the media scales instead of
        // warping. Checked on every move, so Shift can be pressed or
        // released mid-drag.
        if (event.shiftKey) {
          if (!drag.proportional) {
            const aspect =
              mediaAspect && mediaAspect > 0
                ? mediaAspect
                : cornersAspect(surface.corners, p.width, p.height)
            drag.proportional = {
              anchor: surface.corners[(index + 2) % 4],
              aspect,
              frames: captureEdgeNodeFrames(surface.corners, surface.edgeNodes, p.width, p.height)
            }
            setLockHint({ index, label: aspectLabel(aspect) })
          }
          const { anchor, aspect, frames } = drag.proportional
          const corners = proportionalCorners(index, anchor, { x, y }, aspect, p.width, p.height)
          onCornersChange?.(corners)
          // Bends scale with the surface rather than staying put.
          if (frames.length > 0) {
            onEdgeNodesChange?.(
              applyEdgeNodeFrames(surface.edgeNodes, frames, corners, p.width, p.height)
            )
          }
          return
        }
        if (drag.proportional) {
          drag.proportional = undefined
          setLockHint(null)
        }

        const next = surface.corners.map((c, i) =>
          i === index ? { x, y } : c
        ) as Surface['corners']
        onCornersChange?.(next)
      } else {
        onEdgeNodesChange?.(moveEdgeNode(surface.edgeNodes, drag.target.id, x, y))
      }
    },
    [mediaAspect, onCornersChange, onEdgeNodesChange, surface.corners, surface.edgeNodes, toLocal]
  )

  const endDrag = useCallback(() => {
    if (dragRef.current) endShapeGesture()
    dragRef.current = null
    setLockHint(null)
  }, [])

  /** Double-click an outline segment: add a node exactly where you clicked. */
  const handleSegmentDoubleClick = useCallback(
    (index: number) => (event: MouseEvent<SVGLineElement>) => {
      if (!containerRef.current || !onEdgeNodesChange) return
      const a = outline[index]
      const b = outline[(index + 1) % outline.length]
      // The segment's far end belongs to the next edge when `a` is that
      // edge's last point; along *this* edge it's the end corner, t = 1.
      const tEnd = b.edge === a.edge ? b.t : 1
      const p = toLocal(event)
      // Project the click onto the segment in pixel space.
      const ax = a.x * p.width
      const ay = a.y * p.height
      const dx = b.x * p.width - ax
      const dy = b.y * p.height - ay
      const len2 = dx * dx + dy * dy
      if (len2 === 0) return
      const s = clamp01(((p.x - ax) * dx + (p.y - ay) * dy) / len2)
      onEdgeNodesChange(
        insertEdgeNode(
          surface.edgeNodes,
          a.edge,
          a.t + (tEnd - a.t) * s,
          a.x + (b.x - a.x) * s,
          a.y + (b.y - a.y) * s
        )
      )
    },
    [onEdgeNodesChange, outline, surface.edgeNodes, toLocal]
  )

  const handleNodeKeyDown = useCallback(
    (id: string) => (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      event.preventDefault()
      onEdgeNodesChange?.(removeEdgeNode(surface.edgeNodes, id))
    },
    [onEdgeNodesChange, surface.edgeNodes]
  )

  return (
    <div
      className={`projection-canvas${ghost ? ' ghost' : ''}${mediaUrl ? '' : ' empty'}`}
      ref={containerRef}
      style={{ '--surface-color': surface.outlineColor } as CSSProperties}
      onPointerMove={editable ? handlePointerMove : undefined}
      onPointerUp={editable ? endDrag : undefined}
      onPointerCancel={editable ? endDrag : undefined}
      onLostPointerCapture={editable ? endDrag : undefined}
    >
      {/* Normalized 0..1 viewBox stretched to the container, so the outline
          uses the exact same coordinates as the mesh and the handles.
          non-scaling-stroke keeps the line a crisp 2px. */}
      {(editable || ghost) && (
        <svg
          className="surface-outline"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon points={points} className="surface-outline-tint" />
          <polygon
            points={points}
            className="surface-outline-halo"
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            points={points}
            className="surface-outline-line"
            vectorEffect="non-scaling-stroke"
          />
          {/* Wide invisible strokes along each segment: double-click target
              for inserting a node. */}
          {editable &&
            outline.map((a, index) => {
              const b = outline[(index + 1) % outline.length]
              return (
                <line
                  key={`${a.edge}-${a.nodeId ?? 'corner'}`}
                  className="edge-hit"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  vectorEffect="non-scaling-stroke"
                  onDoubleClick={handleSegmentDoubleClick(index)}
                />
              )
            })}
        </svg>
      )}
      {editable &&
        surface.edgeNodes.map((nodes, edge) =>
          nodes.map((node, i) => (
            <div
              key={node.id}
              className="edge-node-handle"
              tabIndex={0}
              aria-label={`${surface.name} ${EDGE_LABELS[edge]} edge node ${i + 1}. Press Delete to remove.`}
              style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}
              onPointerDown={startDrag({ kind: 'node', id: node.id }, node)}
              onKeyDown={handleNodeKeyDown(node.id)}
            >
              <span className="edge-node-ring" />
              <span className="edge-node-dot" />
            </div>
          ))
        )}
      {editable &&
        surface.corners.map((corner, index) => (
          <div
            key={index}
            className="corner-handle"
            aria-label={`${surface.name} ${CORNER_LABELS[index]} corner`}
            title="Shift-drag to keep the media’s proportions"
            style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
            onPointerDown={startDrag({ kind: 'corner', index }, corner)}
          >
            <span className="corner-ring" />
            <span className="corner-dot" />
          </div>
        ))}
      {editable && lockHint && (
        <div
          className={`ratio-lock ratio-lock-${lockHint.index}`}
          style={{
            left: `${surface.corners[lockHint.index].x * 100}%`,
            top: `${surface.corners[lockHint.index].y * 100}%`
          }}
          aria-live="polite"
        >
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <rect x="2" y="5.5" width="8" height="5.5" rx="1.2" fill="currentColor" />
            <path
              d="M4 5.5V4a2 2 0 0 1 4 0v1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
          {lockHint.label}
        </div>
      )}
    </div>
  )
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
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
