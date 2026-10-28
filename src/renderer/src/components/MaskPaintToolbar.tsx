import { useEffect, type CSSProperties } from 'react'
import {
  MAX_BRUSH,
  MIN_BRUSH,
  endMaskPaint,
  fillMask,
  redoPaint,
  setBrushSize,
  setBrushTool,
  undoPaint,
  useMaskPaint
} from '../state/maskPaint'

interface MaskPaintToolbarProps {
  surfaceName: string
}

/**
 * Floating toolbar over the stage while a mask is being painted.
 * Keys: X swaps Hide/Reveal, [ and ] change the brush, Esc or Enter
 * finishes. ⌘Z / ⇧⌘Z undo strokes (routed from the Edit menu in App).
 */
export default function MaskPaintToolbar({ surfaceName }: MaskPaintToolbarProps) {
  const tool = useMaskPaint((s) => s.tool)
  const brush = useMaskPaint((s) => s.brush)
  const canUndo = useMaskPaint((s) => s.canUndo)
  const canRedo = useMaskPaint((s) => s.canRedo)
  const saving = useMaskPaint((s) => s.saving)
  const error = useMaskPaint((s) => s.error)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const el = event.target
      if (el instanceof HTMLTextAreaElement) return
      if (el instanceof HTMLInputElement && el.type !== 'range') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const state = useMaskPaint.getState()
      if (event.key === 'x' || event.key === 'X') {
        setBrushTool(state.tool === 'hide' ? 'reveal' : 'hide')
      } else if (event.key === '[') {
        setBrushSize(state.brush / 1.25)
      } else if (event.key === ']') {
        setBrushSize(state.brush * 1.25)
      } else if (event.key === 'Escape' || event.key === 'Enter') {
        void endMaskPaint()
      } else {
        return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const fill = ((brush - MIN_BRUSH) / (MAX_BRUSH - MIN_BRUSH)) * 100

  return (
    <div className="mask-toolbar" role="toolbar" aria-label={`Painting the mask on ${surfaceName}`}>
      <div className="segmented" role="radiogroup" aria-label="Brush">
        <button
          type="button"
          role="radio"
          aria-checked={tool === 'hide'}
          title="Paint darkness (X to swap)"
          onClick={() => setBrushTool('hide')}
        >
          Hide
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={tool === 'reveal'}
          title="Paint light back (X to swap)"
          onClick={() => setBrushTool('reveal')}
        >
          Reveal
        </button>
      </div>

      <label className="mask-toolbar-size">
        <span>Size</span>
        <input
          className="slider"
          type="range"
          min={MIN_BRUSH}
          max={MAX_BRUSH}
          value={brush}
          aria-label="Brush size"
          title="[ and ] change the size"
          style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(e) => setBrushSize(Number(e.target.value))}
        />
      </label>

      <div className="mask-toolbar-group">
        <button
          type="button"
          className="icon-btn"
          onClick={() => undoPaint()}
          disabled={!canUndo}
          aria-label="Undo stroke"
          title="Undo stroke (⌘Z)"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              d="M5.5 3.5 2.5 6.5l3 3M2.8 6.5h6.7a4 4 0 0 1 0 8H7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => redoPaint()}
          disabled={!canRedo}
          aria-label="Redo stroke"
          title="Redo stroke (⇧⌘Z)"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              d="M10.5 3.5l3 3-3 3M13.2 6.5H6.5a4 4 0 0 0 0 8H9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="mask-toolbar-group">
        <button type="button" className="btn btn-ghost" onClick={() => fillMask(false)}>
          Hide all
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => fillMask(true)}>
          Show all
        </button>
      </div>

      <span className="mask-toolbar-status" role="status">
        {error ?? (saving ? 'Saving…' : '')}
      </span>

      <button type="button" className="btn" onClick={() => void endMaskPaint()}>
        Done
      </button>
    </div>
  )
}
