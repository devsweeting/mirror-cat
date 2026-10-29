import { useEffect, type CSSProperties } from 'react'
import {
  MAX_BRUSH,
  MIN_BRUSH,
  cancelDraft,
  endMaskPaint,
  redoPaint,
  removeDraftPoint,
  resetMask,
  setBrushSize,
  setMaskOp,
  setMaskTool,
  swapMaskOp,
  undoPaint,
  useMaskPaint
} from '../state/maskPaint'

interface MaskPaintToolbarProps {
  surfaceName: string
  surfaceColor: string
}

/**
 * Mask mode's toolbar. It takes the prompt bar's place under the stage
 * while you edit a mask, so nothing on screen moves and there's exactly one
 * place to finish. Keys: O / B pick the tool, X swaps light and dark,
 * [ and ] size the brush, Backspace drops the last outline point, Esc
 * cancels an outline or finishes, ⌘Z / ⇧⌘Z undo and redo (via the Edit
 * menu, routed in App).
 */
export default function MaskPaintToolbar({ surfaceName, surfaceColor }: MaskPaintToolbarProps) {
  const tool = useMaskPaint((s) => s.tool)
  const op = useMaskPaint((s) => s.op)
  const brush = useMaskPaint((s) => s.brush)
  const drafting = useMaskPaint((s) => s.draft.length > 0)
  const canUndo = useMaskPaint((s) => s.canUndo || s.draft.length > 0)
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
      const key = event.key.toLowerCase()
      if (key === 'o') setMaskTool('outline')
      else if (key === 'b') setMaskTool('brush')
      else if (key === 'x') swapMaskOp()
      else if (key === '[') setBrushSize(state.brush / 1.25)
      else if (key === ']') setBrushSize(state.brush * 1.25)
      else if ((key === 'backspace' || key === 'delete') && state.draft.length > 0) {
        removeDraftPoint()
      } else if (key === 'escape') {
        if (state.draft.length > 0) cancelDraft()
        else void endMaskPaint()
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hint =
    tool === 'outline'
      ? drafting
        ? 'Double-click or click the first point to finish. Backspace removes a point, Esc cancels.'
        : op === 'light'
          ? 'Click around a shape to light only it. More outlines add to the lit area.'
          : 'Click around a shape to darken it.'
      : 'Drag to paint. X swaps light and dark, [ and ] change the size.'

  const fill = ((brush - MIN_BRUSH) / (MAX_BRUSH - MIN_BRUSH)) * 100

  return (
    <div className="composer-wrap mask-bar-wrap">
      <div
        className="mask-bar"
        role="toolbar"
        aria-label={`Editing the mask on ${surfaceName}`}
        style={{ '--surface-color': surfaceColor } as CSSProperties}
      >
        <div className="segmented" role="radiogroup" aria-label="Mask tool">
          <button
            type="button"
            role="radio"
            aria-checked={tool === 'outline'}
            title="Outline a shape (O)"
            onClick={() => setMaskTool('outline')}
          >
            <OutlineIcon />
            Outline
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={tool === 'brush'}
            title="Paint by hand (B)"
            onClick={() => setMaskTool('brush')}
          >
            <BrushIcon />
            Brush
          </button>
        </div>

        <div className="segmented" role="radiogroup" aria-label="Light or dark">
          <button
            type="button"
            role="radio"
            aria-checked={op === 'light'}
            title="Add light (X to swap)"
            onClick={() => setMaskOp('light')}
          >
            Light
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={op === 'dark'}
            title="Remove light (X to swap)"
            onClick={() => setMaskOp('dark')}
          >
            Dark
          </button>
        </div>

        {tool === 'brush' && (
          <input
            className="slider mask-bar-size"
            type="range"
            min={MIN_BRUSH}
            max={MAX_BRUSH}
            value={brush}
            aria-label="Brush size"
            title="Brush size ([ and ])"
            style={{ '--fill': `${fill}%` } as CSSProperties}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />
        )}

        <span className="mask-bar-spacer" />

        <button
          type="button"
          className="icon-btn"
          onClick={() => undoPaint()}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo (⌘Z)"
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
          aria-label="Redo"
          title="Redo (⇧⌘Z)"
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
        <button
          type="button"
          className="btn btn-ghost"
          onClick={resetMask}
          title="Light the whole surface again"
        >
          Reset
        </button>
        <button type="button" className="btn mask-bar-done" onClick={() => void endMaskPaint()}>
          Done
        </button>
      </div>
      <p className={`mask-bar-hint${error ? ' error' : ''}`} role="status">
        {error ?? hint}
        {!error && saving && <span className="mask-bar-saving">Saving</span>}
      </p>
    </div>
  )
}

function OutlineIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3 4.5 11.5 3 13 11 4.5 13Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="2.2 1.6"
        strokeLinejoin="round"
      />
      <circle cx="3" cy="4.5" r="1.4" fill="currentColor" />
      <circle cx="11.5" cy="3" r="1.4" fill="currentColor" />
      <circle cx="13" cy="11" r="1.4" fill="currentColor" />
    </svg>
  )
}

function BrushIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M13.5 2.5 7.2 8.8M7.2 8.8c-1.6-.3-3.2.8-3.2 2.6 0 1.1-.6 1.9-1.5 2.1 2.6.9 5.3-.3 5.5-2.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
