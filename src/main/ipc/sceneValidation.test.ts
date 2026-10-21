import { describe, expect, it } from 'vitest'
import { MAX_SURFACES, normalizeScene } from './sceneValidation'
import { createSurface } from '../../shared/types'
import { insertEdgeNode, MAX_EDGE_NODES } from '../../shared/surfaceGeometry'

describe('normalizeScene', () => {
  it('passes a valid scene through, keeping the play token', () => {
    const surface = { ...createSurface('a', 'A'), playToken: 3, assetId: 'b'.repeat(64) }
    const scene = normalizeScene({ surfaces: [surface], outputDisplayId: 7 })
    expect(scene).toEqual({ surfaces: [surface], outputDisplayId: 7 })
  })

  it('rejects the whole update if any surface is malformed', () => {
    const good = createSurface('a', 'A')
    expect(normalizeScene({ surfaces: [good, { id: 'x' }], outputDisplayId: null })).toBeNull()
  })

  it('rejects non-objects and oversized scenes', () => {
    expect(normalizeScene(null)).toBeNull()
    expect(normalizeScene('scene')).toBeNull()
    expect(normalizeScene({ surfaces: 'nope' })).toBeNull()
    const many = Array.from({ length: MAX_SURFACES + 1 }, (_, i) => createSurface(`s${i}`, 'S'))
    expect(normalizeScene({ surfaces: many, outputDisplayId: null })).toBeNull()
  })

  it('strips unexpected fields and bad values', () => {
    const scene = normalizeScene({
      surfaces: [
        {
          ...createSurface('a', 'A'),
          assetId: '../../secrets',
          playToken: -1,
          name: 'n'.repeat(500),
          extra: { huge: 'x'.repeat(1000) }
        }
      ],
      outputDisplayId: '1'
    })
    const s = scene!.surfaces[0] as unknown as Record<string, unknown>
    expect(s.assetId).toBeNull()
    expect(s.playToken).toBe(0)
    expect((s.name as string).length).toBe(120)
    expect(s).not.toHaveProperty('extra')
    expect(scene!.outputDisplayId).toBeNull()
  })

  it('caps edge nodes at the per-surface limit', () => {
    const surface = createSurface('a', 'A')
    const node = insertEdgeNode([[], [], [], []], 0, 0.5, 0.5, 0.15)[0][0]
    const flood = Array.from({ length: MAX_EDGE_NODES + 10 }, (_, i) => ({ ...node, id: `n${i}` }))
    const scene = normalizeScene({
      surfaces: [{ ...surface, edgeNodes: [flood, [], [], []] }],
      outputDisplayId: null
    })
    expect(scene!.surfaces[0].edgeNodes.flat()).toHaveLength(MAX_EDGE_NODES)
  })
})
