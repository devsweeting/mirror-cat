import { create } from 'zustand'
import { DEFAULT_MASK_PARAMS, MASK_PAINT_EDGE, maskUrl } from '@shared/mask'
import type { Surface } from '@shared/types'
import type { WarpPick } from '@shared/warpPick'
import { cornersAspect } from '@shared/proportionalResize'
import { canvasToPng, loadImage, saveMaskPng } from '../masks/maskImage'
import { useSceneStore } from './sceneStore'

/**
 * Mask editing ("mask mode"): one session at a time, on the selected
 * surface, in the control window only.
 *
 * The working image is an offscreen canvas in the surface's content space
 * (u across, v down; white = lit). Two tools draw on it:
 *
 * - Outline: click points around a shape and close it. The first "light"
 *   outline on a fully lit surface darkens everything else -- "light only
 *   this" is what you mean when you outline an object. Later outlines add
 *   to (or, in dark mode, cut from) what's lit.
 * - Brush: drag to paint light or dark, for edges and touch-ups.
 *
 * While a session is open, every editor view of the surface uses this
 * canvas directly as its mask. A moment after each change it's saved as a
 * mask PNG and set on the surface, which is what reaches the projector and
 * the autosave.
 */
export type MaskTool = 'outline' | 'brush'
export type MaskOp = 'light' | 'dark'
export interface ScreenPoint {
  x: number
  y: number
}

interface MaskPaintState {
  /** Surface being edited, or null when mask mode is off. */
  surfaceId: string | null
  tool: MaskTool
  op: MaskOp
  /** Brush radius in on-screen (stage) pixels. */
  brush: number
  /** Outline in progress, in stage-container pixels. */
  draft: ScreenPoint[]
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
  tool: 'outline',
  op: 'light',
  brush: 28,
  draft: [],
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
 * Turn mask mode on for `surface`, shaping a fresh canvas like the surface
 * looks on the stage. Starts from the surface's mask if it has one.
 */
export function startMaskMode(surface: Surface): Promise<void> {
  const stage = document.querySelector<HTMLElement>('.editor-stage')
  const aspect = stage
    ? cornersAspect(surface.corners, stage.clientWidth, stage.clientHeight)
    : 16 / 9
  return startMaskPaint(surface, aspect)
}

/** Mask mode on for the surface, or off if it's already on. */
export function toggleMaskMode(surface: Surface | null): void {
  if (useMaskPaint.getState().surfaceId) {
    void endMaskPaint()
    return
  }
  if (surface?.visible) {
    startMaskMode(surface).catch((error: unknown) => {
      console.error('[masks] could not open the mask', error)
      useMaskPaint.setState({ error: 'Couldn’t open the mask for editing.' })
    })
  }
}

/**
 * Open a session on `surface`. With no mask yet, the canvas is fully lit
 * and shaped like the surface on screen (`aspect` = width / height).
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
  // A new mask starts where it almost always starts: outline the object.
  // Editing an existing one keeps whichever tool you used last.
  const fresh = surface.mask ? {} : { tool: 'outline' as const, op: 'light' as const }
  bump({ surfaceId: surface.id, error: null, saving: false, draft: [], ...fresh })
}

/** Close the session, saving any unsaved changes first. */
export async function endMaskPaint(): Promise<void> {
  if (!useMaskPaint.getState().surfaceId) return
  flushCommit()
  await commits
  session++
  canvas = null
  ctx = null
  undoStack = []
  redoStack = []
  useMaskPaint.setState({
    surfaceId: null,
    draft: [],
    canUndo: false,
    canRedo: false,
    saving: false
  })
}

export function setMaskTool(tool: MaskTool): void {
  useMaskPaint.setState({ tool, draft: [] })
}

export function setMaskOp(op: MaskOp): void {
  useMaskPaint.setState({ op })
}

export function swapMaskOp(): void {
  setMaskOp(useMaskPaint.getState().op === 'light' ? 'dark' : 'light')
}

export function setBrushSize(brush: number): void {
  useMaskPaint.setState({ brush: Math.round(Math.min(MAX_BRUSH, Math.max(MIN_BRUSH, brush))) })
}

// ---------- Outline drafting ----------

export function addDraftPoint(point: ScreenPoint): void {
  useMaskPaint.setState((s) => ({ draft: [...s.draft, point] }))
}

export function removeDraftPoint(): void {
  useMaskPaint.setState((s) => ({ draft: s.draft.slice(0, -1) }))
}

export function cancelDraft(): void {
  useMaskPaint.setState({ draft: [] })
}

/**
 * Fill a closed outline (already mapped into content space, 0..1) with
 * light or dark. A light outline on a fully lit mask darkens everything
 * outside it first.
 */
export function fillOutline(contentPoints: readonly { u: number; v: number }[], op: MaskOp): void {
  const c = ctx
  if (!canvas || !c || contentPoints.length < 3) return
  const w = canvas.width
  const h = canvas.height
  const isolate = op === 'light' && isFullyLit()
  snapshot()
  if (isolate) {
    c.fillStyle = litColor(false)
    c.fillRect(0, 0, w, h)
  }
  c.fillStyle = litColor(op === 'light')
  c.beginPath()
  contentPoints.forEach((p, i) => {
    if (i === 0) c.moveTo(p.u * w, p.v * h)
    else c.lineTo(p.u * w, p.v * h)
  })
  c.closePath()
  c.fill()
  dirty = true
  useMaskPaint.setState({ draft: [] })
  changed()
}

/** True when every pixel currently shows as lit (accounting for invert). */
function isFullyLit(): boolean {
  if (!canvas || !ctx) return false
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const litIsWhite = litColor(true) === '#fff'
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] >= 128 !== litIsWhite) return false
  }
  return true
}

// ---------- Brush ----------

/** Call once at the start of each brush stroke: it's the unit undo works in. */
export function beginStroke(): void {
  if (!canvas || !ctx) return
  snapshot()
  ctx.fillStyle = litColor(useMaskPaint.getState().op === 'light')
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
  changed()
}

// ---------- Whole-mask actions and history ----------

/** Light up the whole surface again. Undoable. */
export function resetMask(): void {
  if (!canvas || !ctx) return
  snapshot()
  ctx.fillStyle = litColor(true)
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  dirty = true
  changed()
}

export function undoPaint(): boolean {
  if (useMaskPaint.getState().draft.length > 0) {
    removeDraftPoint()
    return true
  }
  return swap(undoStack, redoStack)
}

export function redoPaint(): boolean {
  return swap(redoStack, undoStack)
}

function snapshot(): void {
  if (!canvas || !ctx) return
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
  if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  redoStack = []
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = null
}

function swap(from: ImageData[], to: ImageData[]): boolean {
  const previous = from.pop()
  if (!previous || !canvas || !ctx) return false
  to.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
  ctx.putImageData(previous, 0, 0)
  dirty = true
  changed()
  return true
}

function changed(): void {
  bump()
  scheduleCommit()
}

/**
 * Canvas color for lit / dark. A mask set to invert shows its black parts,
 * so the tools paint the opposite color -- "light" always lights the wall.
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
        error: reason ?? 'Couldn’t save the mask. Your changes are kept; try again.'
      })
    })
    .finally(() => {
      if (!commitTimer) useMaskPaint.setState({ saving: false })
    })
}
