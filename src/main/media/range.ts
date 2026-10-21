// Kept apart from protocol.ts (which needs Electron) so it's testable in
// plain Node.

/**
 * Single-range "bytes=start-end", "bytes=start-" or suffix "bytes=-n".
 * Returns null for anything unsatisfiable (or multi-range, which media
 * elements never send).
 */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size === 0) return null
  const [, rawStart, rawEnd] = match
  let start: number
  let end: number
  if (rawStart === '') {
    if (rawEnd === '') return null
    const suffix = Number(rawEnd)
    if (suffix === 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return null
  }
  return { start, end }
}
