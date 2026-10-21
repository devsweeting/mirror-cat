import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

const { isSafeExternalUrl, isSamePage } = await import('./security')

describe('isSafeExternalUrl', () => {
  it.each([
    ['https://example.com/docs', true],
    ['http://example.com', false],
    ['file:///etc/passwd', false],
    ['smb://server/share', false],
    ['javascript:alert(1)', false],
    ['mirrorcat-media://asset/x', false],
    ['not a url', false]
  ])('%s → %s', (url, safe) => expect(isSafeExternalUrl(url)).toBe(safe))
})

describe('isSamePage', () => {
  it('allows hash-only changes on the app page', () => {
    expect(isSamePage('file:///app/index.html#/output', 'file:///app/index.html')).toBe(true)
    expect(isSamePage('http://localhost:5173/#x', 'http://localhost:5173/')).toBe(true)
  })

  it('blocks anything else', () => {
    expect(isSamePage('file:///Users/me/photo.jpg', 'file:///app/index.html')).toBe(false)
    expect(isSamePage('https://evil.example/', 'http://localhost:5173/')).toBe(false)
    expect(isSamePage('http://localhost:5174/', 'http://localhost:5173/')).toBe(false)
  })
})
