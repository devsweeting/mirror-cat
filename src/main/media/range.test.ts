import { describe, expect, it } from 'vitest'
import { parseRange } from './range'

describe('parseRange', () => {
  it.each([
    ['bytes=0-99', 1000, { start: 0, end: 99 }],
    ['bytes=500-', 1000, { start: 500, end: 999 }],
    ['bytes=-100', 1000, { start: 900, end: 999 }],
    ['bytes=-5000', 1000, { start: 0, end: 999 }],
    ['bytes=900-5000', 1000, { start: 900, end: 999 }],
    [' bytes=0-0 ', 1, { start: 0, end: 0 }]
  ])('%s of %d', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected)
  })

  it.each([
    ['bytes=1000-', 1000],
    ['bytes=5-2', 1000],
    ['bytes=-0', 1000],
    ['bytes=-', 1000],
    ['bytes=0-1,5-9', 1000],
    ['items=0-1', 1000],
    ['bytes=0-1', 0],
    ['bytes=99999999999999999999-', 1000]
  ])('rejects %s (size %d)', (header, size) => {
    expect(parseRange(header, size)).toBeNull()
  })
})
