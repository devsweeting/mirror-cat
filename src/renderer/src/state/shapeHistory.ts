import type { CornerSet, EdgeNodeSet, Surface } from '@shared/types'
import { useSceneStore } from './sceneStore'

/**
 * Undo/redo for surface *shape*: corner pins and edge nodes, which is the
 * calibration work that's slow to redo by hand.
 *
 * Every shape edit goes through `editCorners` / `editEdgeNodes` below
 * instead of calling the scene store directly. Each records the surface's
 * shape *before* the change, so undo restores exactly what was there.
 *
 * A drag is one undo step, not hundreds: `beginShapeGesture` (on
 * pointerdown) opens a gesture, the first change inside it records a
 * snapshot, later changes in the same gesture don't, and `endShapeGesture`
 * (on pointerup) closes it. A click that doesn't move records nothing.
 * Edits outside a gesture (stepper, double-click insert, Delete) are one
 * step each.
 *
 * Kept outside the scene store on purpose: history isn't part of the scene,
 * so it must never be synced to the projector or autosaved.
 */

interface ShapeSnapshot {
  surfaceId: string
  corners: CornerSet
  edgeNodes: EdgeNodeSet
}

/** Enough for a long calibration session; old steps fall off the end. */
const HISTORY_LIMIT = 100

const past: ShapeSnapshot[] = []
const future: ShapeSnapshot[] = []
let gesture: { surfaceId: string; recorded: boolean } | null = null

function findSurface(surfaceId: string): Surface | undefined {
  return useSceneStore.getState().surfaces.find((s) => s.id === surfaceId)
}

function snapshot(surface: Surface): ShapeSnapshot {
  // Corners and node sets are replaced immutably on every edit, never
  // mutated, so holding the current references is a safe snapshot.
  return { surfaceId: surface.id, corners: surface.corners, edgeNodes: surface.edgeNodes }
}

function record(surfaceId: string): void {
  if (gesture && gesture.surfaceId === surfaceId) {
    if (gesture.recorded) return
    gesture.recorded = true
  }
  const surface = findSurface(surfaceId)
  if (!surface) return
  past.push(snapshot(surface))
  if (past.length > HISTORY_LIMIT) past.shift()
  // A new edit makes the redo branch unreachable, as in every editor.
  future.length = 0
}

function apply(entry: ShapeSnapshot): void {
  useSceneStore.setState((state) => ({
    surfaces: state.surfaces.map((s) =>
      s.id === entry.surfaceId ? { ...s, corners: entry.corners, edgeNodes: entry.edgeNodes } : s
    )
  }))
}

/**
 * Move `entry`'s surface to its recorded shape, pushing its current shape
 * onto `opposite` so the step can be reversed. Entries for surfaces that
 * have since been deleted are skipped. Returns the surface id, or null if
 * there was nothing to do.
 */
function step(from: ShapeSnapshot[], opposite: ShapeSnapshot[]): string | null {
  // Ignore undo mid-drag; the drag would immediately overwrite it.
  if (gesture) return null
  while (from.length > 0) {
    const entry = from.pop()!
    const surface = findSurface(entry.surfaceId)
    if (!surface) continue
    opposite.push(snapshot(surface))
    apply(entry)
    return entry.surfaceId
  }
  return null
}

export function editCorners(surfaceId: string, corners: CornerSet): void {
  if (findSurface(surfaceId)?.corners === corners) return
  record(surfaceId)
  useSceneStore.getState().updateCorners(surfaceId, corners)
}

export function editEdgeNodes(surfaceId: string, edgeNodes: EdgeNodeSet): void {
  // Geometry helpers return the same set when an edit is refused (node
  // limit, too close to a neighbour); that isn't an undoable step.
  if (findSurface(surfaceId)?.edgeNodes === edgeNodes) return
  record(surfaceId)
  useSceneStore.getState().updateEdgeNodes(surfaceId, edgeNodes)
}

export function beginShapeGesture(surfaceId: string): void {
  gesture = { surfaceId, recorded: false }
}

export function endShapeGesture(): void {
  gesture = null
}

/** Returns the id of the surface that changed, so the editor can select it. */
export function undoShape(): string | null {
  return step(past, future)
}

export function redoShape(): string | null {
  return step(future, past)
}
