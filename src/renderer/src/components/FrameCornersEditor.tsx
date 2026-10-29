import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { CornerSet } from '@shared/types'
import { CORNER_NAMES } from '@shared/scanPattern'

interface FrameCornersEditorProps {
  imageUrl: string
  /** Frame corners in the photo, 0..1 (TL, TR, BR, BL). */
  corners: CornerSet
  onChange: (corners: CornerSet) => void
  /** Corners whose marker wasn't found -- shown highlighted to check. */
  unsure: readonly number[]
}

const NUDGE = 0.0025
const NUDGE_BIG = 0.02

/**
 * The scan photo with the projector frame outlined on it. Drag a corner, or
 * focus it and use the arrow keys (Shift for bigger steps), to put it on
 * the glowing frame's corner. Coordinates are 0..1 of the photo; the
 * wrapper takes the photo's own aspect ratio so they line up exactly.
 */
export default function FrameCornersEditor({
  imageUrl,
  corners,
  onChange,
  unsure
}: FrameCornersEditorProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [aspect, setAspect] = useState<number | null>(null)
  const dragging = useRef<number | null>(null)

  const moveTo = (index: number, x: number, y: number): void => {
    const next = corners.map((c, i) =>
      i === index ? { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } : c
    ) as CornerSet
    onChange(next)
  }

  const pointFromEvent = (event: PointerEvent<HTMLElement>): { x: number; y: number } | null => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  const handlePointerDown = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = index
  }

  const handlePointerMove = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (dragging.current !== index) return
    const p = pointFromEvent(event)
    if (p) moveTo(index, p.x, p.y)
  }

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? NUDGE_BIG : NUDGE
    const c = corners[index]
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    }
    const d = delta[event.key]
    if (!d) return
    event.preventDefault()
    moveTo(index, c.x + d[0], c.y + d[1])
  }

  const points = corners.map((c) => `${c.x},${c.y}`).join(' ')

  return (
    <div className="frame-editor">
      <div
        ref={boxRef}
        className="frame-editor-box"
        style={
          aspect
            ? { aspectRatio: String(aspect), maxWidth: `calc(420px * ${aspect})` }
            : undefined
        }
      >
        <img
          src={imageUrl}
          alt="The photo from your phone"
          draggable={false}
          onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        />
        <svg className="frame-editor-outline" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          <polygon points={points} className="frame-editor-shade" />
          <polygon points={points} className="frame-editor-halo" vectorEffect="non-scaling-stroke" />
          <polygon points={points} className="frame-editor-line" vectorEffect="non-scaling-stroke" />
        </svg>
        {corners.map((c, i) => (
          <button
            key={i}
            type="button"
            className={`frame-editor-handle${unsure.includes(i) ? ' unsure' : ''}`}
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
            aria-label={`Projector frame ${CORNER_NAMES[i]} corner${unsure.includes(i) ? ', check this one' : ''}`}
            title="Drag onto the frame’s corner, or use the arrow keys"
            onPointerDown={handlePointerDown(i)}
            onPointerMove={handlePointerMove(i)}
            onPointerUp={() => (dragging.current = null)}
            onPointerCancel={() => (dragging.current = null)}
            onKeyDown={handleKeyDown(i)}
          />
        ))}
      </div>
    </div>
  )
}
