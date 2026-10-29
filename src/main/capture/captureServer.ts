import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import type { AddressInfo } from 'net'
import type { MediaAsset } from '../../shared/media'
import {
  CAPTURE_SESSION_MS,
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_UPLOADS,
  type CaptureEvent
} from '../../shared/capture'
import { EXPIRED_PAGE, phonePageHtml } from './phonePage'

export interface CaptureServerOptions {
  /** LAN address to listen on -- only that interface, never 0.0.0.0. */
  host: string
  /** Store an uploaded photo (the media library's byte-checked import). */
  importPhoto: (bytes: Buffer) => Promise<MediaAsset>
  onEvent: (event: CaptureEvent) => void
  /** Whether the projector is showing the scan pattern right now (changes the phone's instructions). */
  frameShown?: () => boolean
  sessionMs?: number
}

/**
 * A short-lived web server for one scan: it serves the phone page at
 * /c/<token> and accepts photos at /c/<token>/photo, then shuts itself
 * down after CAPTURE_SESSION_MS (or when the Scan dialog closes).
 *
 * It's reachable by anything on the home network while it runs, so:
 * - it listens only while a scan is open, on one LAN address and a random
 *   port;
 * - every route needs the 128-bit one-time token (compared in constant
 *   time), and a wrong token looks exactly like an expired one;
 * - the Host header must match, which defeats DNS-rebinding pages in a
 *   browser on this computer;
 * - only one route accepts data, image bytes only, size-capped and
 *   count-capped, and they go through the library's byte sniffing like
 *   any other import. Nothing is ever read from disk by request.
 */
export class CaptureServer {
  private server: Server | null = null
  private token = ''
  private uploads = 0
  private timer: NodeJS.Timeout | null = null
  private expectedHost = ''

  constructor(private readonly options: CaptureServerOptions) {}

  /** Start listening; resolves with the URL the QR code should carry. */
  async start(): Promise<{ url: string; expiresAt: number }> {
    this.token = randomBytes(16).toString('base64url')
    this.uploads = 0
    const server = createServer((req, res) => void this.handle(req, res))
    server.headersTimeout = 15_000
    server.requestTimeout = 120_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, this.options.host, () => resolve())
    })
    this.server = server
    const { port } = server.address() as AddressInfo
    this.expectedHost = `${this.options.host}:${port}`
    const sessionMs = this.options.sessionMs ?? CAPTURE_SESSION_MS
    this.timer = setTimeout(() => {
      this.stop()
      this.options.onEvent({ type: 'expired' })
    }, sessionMs)
    return { url: `http://${this.expectedHost}/c/${this.token}`, expiresAt: Date.now() + sessionMs }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.server?.close()
    this.server?.closeAllConnections()
    this.server = null
  }

  get running(): boolean {
    return this.server !== null
  }

  private tokenMatches(candidate: string): boolean {
    const a = Buffer.from(candidate)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')

    if (req.headers.host !== this.expectedHost) return send(res, 421, 'text/plain', 'Wrong host')

    const match = /^\/c\/([A-Za-z0-9_-]+)(\/photo)?\/?$/.exec((req.url ?? '').split('?')[0])
    if (!match || !this.tokenMatches(match[1])) return sendExpired(res)

    if (!match[2] && req.method === 'GET') {
      this.options.onEvent({ type: 'visited' })
      const nonce = randomBytes(16).toString('base64')
      res.setHeader(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
      )
      const frameShown = this.options.frameShown?.() ?? false
      return send(res, 200, 'text/html; charset=utf-8', phonePageHtml(nonce, { frameShown }))
    }

    if (match[2] && req.method === 'POST') return this.receivePhoto(req, res)

    return send(res, 405, 'text/plain', 'Not allowed')
  }

  private async receivePhoto(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!/^image\//.test(req.headers['content-type'] ?? '')) {
      return send(res, 415, 'text/plain', 'Send a photo.')
    }
    if (this.uploads >= MAX_CAPTURE_UPLOADS) {
      return send(res, 429, 'text/plain', 'That’s the limit for this scan. Start a new one on your computer.')
    }
    const declared = Number(req.headers['content-length'] ?? 0)
    if (declared > MAX_CAPTURE_BYTES) return tooLarge(res, req)

    this.options.onEvent({ type: 'uploading' })
    const chunks: Buffer[] = []
    let size = 0
    try {
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > MAX_CAPTURE_BYTES) return tooLarge(res, req)
        chunks.push(chunk as Buffer)
      }
    } catch {
      return // phone went away mid-upload
    }

    this.uploads++
    try {
      const asset = await this.options.importPhoto(Buffer.concat(chunks))
      this.options.onEvent({ type: 'photo', asset })
      send(res, 200, 'application/json', JSON.stringify({ ok: true }))
    } catch (error) {
      const message =
        error instanceof Error && error.message.length < 200
          ? error.message
          : 'MirrorCat couldn’t use that photo.'
      this.options.onEvent({ type: 'rejected', message })
      send(res, 422, 'text/plain', message)
    }
  }
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function sendExpired(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
  send(res, 404, 'text/html; charset=utf-8', EXPIRED_PAGE)
}

function tooLarge(res: ServerResponse, req: IncomingMessage): void {
  send(res, 413, 'text/plain', 'That photo is too large.')
  req.destroy()
}
