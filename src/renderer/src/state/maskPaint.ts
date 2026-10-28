import { create } from 'zustand'
import { DEFAULT_MASK_PARAMS, MASK_PAINT_EDGE, maskUrl } from '@shared/mask'
import type { Surface } from '@shared/types'
import type { WarpPick } from '@shared/warpPick'
import { canvasToPng, loadImage, saveMaskPng } from '../masks/maskImage'
import { useSceneStore } from './sceneStore'

/**
 * Mask painting: one session at a time, on the selected surface, in the
 * control window only.
 *
 * The working image is an offscreen canvas in the surface's content space
 * (u across, v down). Brush stamps land on it in the right place and shape
 * however the surface is warped (see stampBrush). While a session is open,
 * every editor view of that surface uses this canvas directly as its mask
 * (live, stroke by stroke). A few hundred ms after each stroke the canvas
 * is saved as a mask PNG and put on the surface, which is what reaches the
 * projector and the autosave.
 */
export type BrushTool = 'hide' | 'reveal'

interface MaskPaintState {
  /** Surface being painted, or null when no session is open. */
  surfaceId: string | null
  tool: BrushTool
  /** Brush radius in on-screen (stage) pixels. */
  brush: number
  /** Bumped on every change to the canvas, so views re-upload it. */
  version: number
  canUndo: boolean
  canRedo: boolean
  saving: boolean
  error: string | null
}

export const MIN_BRUSH = 3
export const MAX_BRUSH = 160
const UNDO_LIMIT = 12
const COMMIT_DELAY_MS = 350

export const useMaskPaint = create<MaskPaintState>(() => ({
  surfaceId: null,
  tool: 'hide',
  brush: 28,
  version: 0,
  canUndo: false,
  canRedo: false,
  saving: false,
  error: null
}))

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let undoStack: ImageData[] = []
let redoStack: ImageData[] = []
let dirty = false
let commitTimer: ReturnType<typeof setTimeout> | null = null
let commits: Promise<void> = Promise.resolve()
/** Incremented per session, so a late load from an old session is ignored. */
let session = 0

/** The live canvas while a session is open (read by the mask hook). */
export function paintCanvas(): HTMLCanvasElement | null {
  return canvas
}

function bump(patch: Partial<MaskPaintState> = {}): void {
  useMaskPaint.setState((s) => ({
    version: s.version + 1,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    ...patch
  }))
}

/**
 * Open a session on `surface`. Starts from its current mask, or -- with
 * none yet -- a fully lit canvas shaped like the surface on screen
 * (`aspect` = width / height), so painting means carving away.
 */
export async function startMaskPaint(surface: Surface, aspect: number): Promise<void> {
  await endMaskPaint()
  const mine = ++session
  const next = document.createElement('canvas')
  if (surface.mask) {
    const image = await loadImage(maskUrl(surface.mask.id))
    if (mine !== session) return
    next.width = image.naturalWidth
    next.height = image.naturalHeight
    next.getContext('2d')!.drawImage(image, 0, 0)
  } else {
    const a = Number.isFinite(aspect) && aspect > 0 ? Math.min(8, Math.max(1 / 8, aspect)) : 1
    next.width = Math.round(a >= 1 ? MASK_PAINT_EDGE : MASK_PAINT_EDGE * a)
    next.height = Math.round(a >= 1 ? MASK_PAINT_EDGE / a : MASK_PAINT_EDGE)
    const c = next.getContext('2d')!
    c.fillStyle = '#fff'
    c.fillRect(0, 0, next.width, next.height)
  }
  canvas = next
  ctx = next.getContext('2d', { willReadFrequently: true })
  undoStack = []
  redoStack = []
  dirty = false
  bump({ surfaceId: surface.id, error: null, saving: false })
}

/** Close the session, saving any unsaved strokes first. */
export async function endMaskPaint(): Promise<void> {
  if (!useMaskPaint.getState().surfaceId) return
  flushCommit()
  await commits
  session++
  canvas = null
  ctx = null
  undoStack = []
  redoStack = []
  useMaskPaint.setState({ surfaceId: null, canUndo: false, canRedo: false, saving: false })
}

export function setBrushTool(tool: BrushTool): void {
  useMaskPaint.setState({ tool })
}

export function setBrushSize(brush: number): void {
  useMaskPaint.setState({ brush: Math.round(Math.min(MAX_BRUSH, Math.max(MIN_BRUSH, brush))) })
}

/** Call once at the start of each stroke: it's the unit undo works in. */
export function beginStroke(): void {
  if (!canvas || !ctx) return
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
  if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  redoStack = []
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = null
  ctx.fillStyle = litColor(useMaskPaint.getState().tool === 'reveal')
}

/**
 * Stamp a round brush of `radius` stage pixels at a picked point. The
 * brush must look round *on the wall*, so it's drawn as the ellipse the
 * warp maps to a circle there: the canvas transform is diag(W, H)·J⁻¹,
 * where J (from the pick) is how content stretches at that spot.
 */
export function stampBrush(pick: WarpPick, radius: number): void {
  if (!canvas || !ctx) return
  if (pick.u < -0.5 || pick.u > 1.5 || pick.v < -0.5 || pick.v > 1.5) return
  const { du, dv } = pick
  const det = du.x * dv.y - dv.x * du.y
  if (Math.abs(det) < 1e-9) return
  const w = canvas.width
  const h = canvas.height
  ctx.setTransform(
    (w * dv.y) / det,
    (h * -du.y) / det,
    (w * -dv.x) / det,
    (h * du.x) / det,
    pick.u * w,
    pick.v * h
  )
  ctx.beginPath()
  ctx.arc(0, 0, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  dirty = true
}

/** After stamps in one pointer event: let the views redraw. */
export function strokeChanged(): void {
  bump()
}

export function endStroke(): void {
  bump()
  scheduleCommit()
}

/** Light up (true) or darken the whole surface. Undoable like a stroke. */
export function fillMask(lit: boolean): void {
  if (!canvas || !ctx) return
  beginStroke()
  ctx.fillStyle = litColor(lit)
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  dirty = true
  endStroke()
}

export function undoPaint(): boolean {
  return swap(undoStack, redoStack)
}

export function redoPaint(): boolean {
  return swap(redoStack, undoStack)
}

function swap(from: ImageData[], to: ImageData[]): boolean {
  const previous = from.pop()
  if (!previous || !canvas || !ctx) return false
  to.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
  ctx.putImageData(previous, 0, 0)
  dirty = true
  endStroke()
  return true
}

/**
 * Canvas color for lit / dark. A mask set to invert shows its black parts,
 * so the brush paints the opposite color -- "Hide" always hides on the wall.
 */
function litColor(lit: boolean): string {
  const surfaceId = useMaskPaint.getState().surfaceId
  const surface = useSceneStore.getState().surfaces.find((s) => s.id === surfaceId)
  const invert = surface?.mask?.invert ?? false
  return lit !== invert ? '#fff' : '#000'
}

function scheduleCommit(): void {
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = setTimeout(flushCommit, COMMIT_DELAY_MS)
}

/** Save the canvas now (if it changed) and put the mask on the surface. */
function flushCommit(): void {
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = null
  const surfaceId = useMaskPaint.getState().surfaceId
  if (!dirty || !canvas || !surfaceId) return
  dirty = false
  const source = canvas
  useMaskPaint.setState({ saving: true })
  commits = commits
    .then(async () => {
      const id = await saveMaskPng(await canvasToPng(source))
      const scene = useSceneStore.getState()
      const surface = scene.surfaces.find((s) => s.id === surfaceId)
      if (!surface) return
      const params = surface.mask ?? DEFAULT_MASK_PARAMS
      scene.setSurfaceMask(surfaceId, {
        id,
        invert: params.invert,
        grow: params.grow,
        feather: params.feather
      })
      useMaskPaint.setState({ error: null })
    })
    .catch((error: unknown) => {
      console.error('[masks] save failed', error)
      dirty = true
      const reason = error instanceof Error && /restart/.test(error.message) ? error.message : null
      useMaskPaint.setState({
        error: reason ?? 'Couldn’t save the mask. Your strokes are kept; try again.'
      })
    })
    .finally(() => {
      if (!commitTimer) useMaskPaint.setState({ saving: false })
    })
}
