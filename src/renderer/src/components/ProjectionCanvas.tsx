import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import * as THREE from 'three'
import { ProjectionEngine } from '../engine/ProjectionEngine'
import type { Surface } from '@shared/types'

interface ProjectionCanvasProps {
  surface: Surface
  textureDataUrl?: string
  /** Show draggable corner-pin handles (control window only). */
  editable?: boolean
  onCornersChange?: (corners: Surface['corners']) => void
}

export default function ProjectionCanvas({
  surface,
  textureDataUrl,
  editable = false,
  onCornersChange
}: ProjectionCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<ProjectionEngine | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const engine = new ProjectionEngine(containerRef.current, surface.corners)
    engineRef.current = engine
    return () => engine.dispose()
    // Only re-create the engine when the container mounts; corner/texture
    // updates are pushed imperatively below instead of re-mounting Three.js.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    engineRef.current?.setCorners(surface.corners)
  }, [surface.corners])

  useEffect(() => {
    if (!textureDataUrl) {
      engineRef.current?.setTexture(null)
      return
    }
    const loader = new THREE.TextureLoader()
    let cancelled = false
    loader.load(textureDataUrl, (texture) => {
      if (cancelled) {
        texture.dispose()
        return
      }
      texture.colorSpace = THREE.SRGBColorSpace
      engineRef.current?.setTexture(texture)
    })
    return () => {
      cancelled = true
    }
  }, [textureDataUrl])

  const handlePointerDown = useCallback(
    (index: number) => (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragIndex(index)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    []
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (dragIndex === null || !containerRef.current || !onCornersChange) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = clamp01((event.clientX - rect.left) / rect.width)
      const y = clamp01((event.clientY - rect.top) / rect.height)
      const next = surface.corners.map((c, i) => (i === dragIndex ? { x, y } : c)) as Surface['corners']
      onCornersChange(next)
    },
    [dragIndex, onCornersChange, surface.corners]
  )

  const handlePointerUp = useCallback(() => setDragIndex(null), [])

  return (
    <div
      className="projection-canvas"
      ref={containerRef}
      onPointerMove={editable ? handlePointerMove : undefined}
      onPointerUp={editable ? handlePointerUp : undefined}
    >
      {editable &&
        surface.corners.map((corner, index) => (
          <div
            key={index}
            className="corner-handle"
            style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
            onPointerDown={handlePointerDown(index)}
          />
        ))}
    </div>
  )
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
