import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { Readable } from 'stream'
import { ASSET_ID_PATTERN, MEDIA_SCHEME } from '../../shared/media'
import type { MediaLibrary } from './mediaLibrary'

// Renderers load from http://localhost in dev and file:// in production,
// so every response is cross-origin. Three.js and our <video> elements
// request with crossOrigin="anonymous"; without this header WebGL refuses
// to use the pixels.
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }

/**
 * Must run before app 'ready'. `standard` gives URLs a real host/path,
 * `secure` + `corsEnabled` let pages fetch them and use them as WebGL
 * textures, and `stream` lets <video> read them progressively.
 */
export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

/**
 * Serves `mirrorcat-media://asset/<id>` (original) and
 * `mirrorcat-media://thumb/<id>` (thumbnail; for images without one, the
 * original). Only ids present in the library index resolve, so a crafted
 * URL can never read an arbitrary path.
 *
 * Files are streamed, never read whole, and HTTP Range requests are
 * honoured: <video> relies on them to seek, to loop, and to read the index
 * at the end of an MP4 without downloading everything before it.
 */
export function registerMediaProtocol(library: MediaLibrary): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const id = url.pathname.replace(/^\/+/, '')
    const kind = url.hostname
    const asset = ASSET_ID_PATTERN.test(id) ? library.get(id) : undefined
    if (!asset || (kind !== 'asset' && kind !== 'thumb')) return notFound()

    let path: string
    let contentType: string
    if (kind === 'thumb' && asset.hasThumbnail) {
      path = library.thumbPath(asset)
      contentType = 'image/jpeg'
    } else if (kind === 'thumb' && asset.kind === 'video') {
      return notFound() // no poster frame yet
    } else {
      path = library.filePath(asset)
      contentType = asset.mimeType
    }

    let size: number
    try {
      size = (await fs.stat(path)).size
    } catch {
      return notFound()
    }

    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      // Asset ids are content hashes, so a URL's bytes never change. Thumbs
      // can appear later, but the same URL never changes content once it
      // exists.
      'Cache-Control': kind === 'thumb' ? 'no-cache' : 'public, max-age=31536000, immutable'
    }

    const range = request.headers.get('range')
    if (!range) {
      return new Response(toWeb(path), {
        status: 200,
        headers: { ...headers, 'Content-Length': String(size) }
      })
    }

    const parsed = parseRange(range, size)
    if (!parsed) {
      return new Response(null, {
        status: 416,
        headers: { ...CORS_HEADERS, 'Content-Range': `bytes */${size}` }
      })
    }
    const { start, end } = parsed
    return new Response(toWeb(path, start, end), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1)
      }
    })
  })
}

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

function toWeb(path: string, start?: number, end?: number): ReadableStream {
  return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: CORS_HEADERS })
}
