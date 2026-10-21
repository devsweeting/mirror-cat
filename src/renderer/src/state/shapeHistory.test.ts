import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CornerSet } from '@shared/types'

// Both modules keep state at module level; load fresh copies per test.
let store: typeof import('./sceneStore')
let history: typeof import('./shapeHistory')

beforeEach(async () => {
  vi.resetModules()
  store = await import('./sceneStore')
  history = await import('./shapeHistory')
})

const surfaces = () => store.useSceneStore.getState().surfaces
const first = () => surfaces()[0]

function shifted(corners: CornerSet, dx: number): CornerSet {
  return corners.map((c) => ({ x: c.x + dx, y: c.y })) as CornerSet
}

describe('shape undo/redo', () => {
  it('undoes and redoes a single edit, returning the surface id', () => {
    const original = first().corners
    history.editCorners(first().id, shifted(original, 0.1))
    expect(first().corners[0].x).toBeCloseTo(0.25)

    expect(history.undoShape()).toBe(first().id)
    expect(first().corners).toBe(original)

    expect(history.redoShape()).toBe(first().id)
    expect(first().corners[0].x).toBeCloseTo(0.25)
    expect(history.redoShape()).toBeNull()
  })

  it('records a whole drag as one step', () => {
    const id = first().id
    const original = first().corners
    history.beginShapeGesture(id)
    for (let k = 1; k <= 20; k++) history.editCorners(id, shifted(original, k * 0.01))
    history.endShapeGesture()

    history.undoShape()
    expect(first().corners).toBe(original)
    expect(history.undoShape()).toBeNull()
  })

  it('refuses to undo mid-drag, and works again once the drag ends', () => {
    const id = first().id
    history.editCorners(id, shifted(first().corners, 0.05))
    history.beginShapeGesture(id)
    expect(history.undoShape()).toBeNull()
    history.endShapeGesture()
    expect(history.undoShape()).toBe(id)
  })

  it('does not record a no-op edit', () => {
    history.editCorners(first().id, first().corners)
    history.editEdgeNodes(first().id, first().edgeNodes)
    expect(history.undoShape()).toBeNull()
  })

  it('drops the redo branch on a new edit', () => {
    const id = first().id
    history.editCorners(id, shifted(first().corners, 0.1))
    history.undoShape()
    history.editCorners(id, shifted(first().corners, 0.02))
    expect(history.redoShape()).toBeNull()
  })

  it('skips steps for surfaces that have since been deleted', () => {
    const keep = first().id
    const gone = store.useSceneStore.getState().addSurface('Temp')
    history.editCorners(keep, shifted(first().corners, 0.1))
    const tempCorners = surfaces().find((s) => s.id === gone)!.corners
    history.editCorners(gone, shifted(tempCorners, 0.1))
    store.useSceneStore.getState().removeSurface(gone)
    expect(history.undoShape()).toBe(keep)
  })

  it('keeps at most 100 steps', () => {
    const id = first().id
    for (let k = 0; k < 130; k++) history.editCorners(id, shifted(first().corners, 0.001))
    let steps = 0
    while (history.undoShape()) steps++
    expect(steps).toBe(100)
  })
})

describe('scene store', () => {
  it('adds surfaces with unused colors and unique ids', () => {
    const { addSurface } = store.useSceneStore.getState()
    const a = addSurface('A')
    const b = addSurface('B')
    expect(a).not.toBe(b)
    const colors = surfaces().map((s) => s.outlineColor)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('renames with trimming and ignores blank names', () => {
    const { renameSurface } = store.useSceneStore.getState()
    renameSurface(first().id, '  Door  ')
    expect(first().name).toBe('Door')
    renameSurface(first().id, '   ')
    expect(first().name).toBe('Door')
  })

  it('restacks surfaces, treating drop-in-place as a no-op', () => {
    const s = store.useSceneStore.getState()
    const b = s.addSurface('B')
    const c = s.addSurface('C')
    const a = first().id
    s.moveSurface(a, c, 'above')
    expect(surfaces().map((x) => x.id)).toEqual([b, c, a])
    const before = surfaces()
    s.moveSurface(a, c, 'above')
    expect(surfaces()).toBe(before)
    s.stepSurface(a, -1)
    expect(surfaces().map((x) => x.id)).toEqual([b, a, c])
    s.stepSurface(b, -1)
    expect(surfaces().map((x) => x.id)).toEqual([b, a, c])
  })

  it('clears an asset from every surface showing it', () => {
    const s = store.useSceneStore.getState()
    const other = s.addSurface('B')
    const asset = 'a'.repeat(64)
    s.setSurfaceAsset(first().id, asset)
    s.setSurfaceAsset(other, asset)
    s.clearAssetEverywhere(asset)
    expect(surfaces().every((x) => x.assetId === null)).toBe(true)
  })

  it('bumps the play token to restart a video', () => {
    const s = store.useSceneStore.getState()
    s.replaySurface(first().id)
    s.replaySurface(first().id)
    expect(first().playToken).toBe(2)
  })
})
