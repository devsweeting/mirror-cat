import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatLabel,
  hasPreview,
  mediaUrl,
  needsProbe,
  thumbnailUrl,
  type MediaAsset
} from './media'
import { SURFACE_PALETTE, createSurface, nextSurfaceColor } from './types'

const base: MediaAsset = {
  id: 'a'.repeat(64),
  kind: 'image',
  name: 'x',
  mimeType: 'image/png',
  ext: 'png',
  width: 10,
  height: 10,
  bytes: 1,
  source: 'upload',
  createdAt: 0,
  hasThumbnail: true,
  probed: true
}

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [7_000, '0:07'],
    [135_000, '2:15'],
    [3_723_000, '1:02:03'],
    [-5, '0:00']
  ])('%d ms → %s', (ms, label) => expect(formatDuration(ms)).toBe(label))
})

describe('asset helpers', () => {
  it('builds protocol URLs', () => {
    expect(mediaUrl(base.id)).toBe(`mirrorcat-media://asset/${base.id}`)
    expect(thumbnailUrl(base.id)).toBe(`mirrorcat-media://thumb/${base.id}`)
    expect(formatLabel({ ext: 'mov' })).toBe('MOV')
  })

  it('knows which assets still need probing', () => {
    expect(needsProbe(base)).toBe(false)
    expect(needsProbe({ ...base, probed: false, hasThumbnail: true })).toBe(false)
    expect(needsProbe({ ...base, probed: false, hasThumbnail: false })).toBe(true)
    expect(needsProbe({ ...base, kind: 'video', probed: false })).toBe(true)
  })

  it('only shows a preview for videos once they have a poster frame', () => {
    expect(hasPreview({ ...base, hasThumbnail: false })).toBe(true)
    expect(hasPreview({ ...base, kind: 'video', hasThumbnail: false })).toBe(false)
    expect(hasPreview({ ...base, kind: 'video', hasThumbnail: true })).toBe(true)
  })
})

describe('surfaces', () => {
  it('picks the first unused palette color, case-insensitively', () => {
    expect(nextSurfaceColor([])).toBe(SURFACE_PALETTE[0])
    expect(nextSurfaceColor([SURFACE_PALETTE[0].toUpperCase()])).toBe(SURFACE_PALETTE[1])
    const all = [...SURFACE_PALETTE]
    expect(SURFACE_PALETTE).toContain(nextSurfaceColor(all))
  })

  it('creates surfaces with independent corner objects', () => {
    const a = createSurface('a', 'A')
    const b = createSurface('b', 'B')
    a.corners[0].x = 0.9
    expect(b.corners[0].x).toBe(0.15)
  })
})
