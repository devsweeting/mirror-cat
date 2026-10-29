import { useEffect, useRef } from 'react'
import {
  MARKER_CELLS,
  MARKER_UNITS,
  PATTERN_BORDER,
  PATTERN_FILL,
  markerBits,
  markerPlacements
} from '@shared/scanPattern'

function gray(v: number): string {
  return `rgb(${v}, ${v}, ${v})`
}

/**
 * The scan pattern, drawn over everything in the projector window while a
 * scan is waiting for its photo: soft light, a bright border, and a marker
 * in each corner (see shared/scanPattern.ts). Drawn at device pixels with
 * the same layout the detector assumes, sized to the window -- which is the
 * frame the detector maps the photo onto.
 */
export default function ScanPattern() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = (): void => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      const ctx = canvas.getContext('2d')
      if (!ctx || width === 0 || height === 0) return
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.imageSmoothingEnabled = false

      const border = Math.max(2, Math.round(Math.min(width, height) * 0.006))
      ctx.fillStyle = gray(PATTERN_BORDER)
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = gray(PATTERN_FILL)
      ctx.fillRect(border, border, width - 2 * border, height - 2 * border)

      for (const m of markerPlacements(width, height)) {
        const unit = m.size / MARKER_UNITS
        ctx.fillStyle = '#fff'
        ctx.fillRect(m.x, m.y, m.size, m.size)
        ctx.fillStyle = '#000'
        ctx.fillRect(m.x + unit, m.y + unit, m.size - 2 * unit, m.size - 2 * unit)
        ctx.fillStyle = '#fff'
        markerBits(m.id).forEach((on, i) => {
          if (!on) return
          const cx = i % MARKER_CELLS
          const cy = Math.floor(i / MARKER_CELLS)
          // Overlap cells by a hair so no seams show between neighbours.
          ctx.fillRect(m.x + (cx + 2) * unit, m.y + (cy + 2) * unit, unit + 0.5, unit + 0.5)
        })
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  return <canvas ref={canvasRef} className="scan-pattern" aria-label="Scan pattern" />
}
