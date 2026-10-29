import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from 'http'
import type { MediaAsset } from '../../shared/media'
import type { CaptureEvent } from '../../shared/capture'
import { MAX_CAPTURE_BYTES } from '../../shared/capture'
import { CaptureServer } from './captureServer'

const FAKE_ASSET = { id: 'a'.repeat(64), name: 'Scan' } as MediaAsset

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** Raw HTTP so the test controls the Host header and body exactly. */
function call(
  url: string,
  {
    method = 'GET',
    host,
    body,
    type,
    declaredLength
  }: { method?: string; host?: string; body?: Buffer; type?: string; declaredLength?: number } = {}
): Promise<Reply> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method,
        // A fresh connection per call: a refused upload closes its socket,
        // which a keep-alive agent would otherwise try to reuse.
        agent: false,
        headers: {
          Host: host ?? u.host,
          ...(type ? { 'Content-Type': type } : {}),
          ...(body ? { 'Content-Length': declaredLength ?? body.length } : {})
        }
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }))
      }
    )
    req.on('error', reject)
    // The server may hang up on a refused upload; that's not a test failure.
    req.on('socket', (socket) => socket.on('error', () => undefined))
    if (body) req.write(body)
    req.end()
  })
}

let server: CaptureServer | null = null

afterEach(() => {
  server?.stop()
  server = null
})

function start(overrides: { importPhoto?: (b: Buffer) => Promise<MediaAsset>; sessionMs?: number } = {}) {
  const events: CaptureEvent[] = []
  const importPhoto = vi.fn(overrides.importPhoto ?? (async () => FAKE_ASSET))
  server = new CaptureServer({
    host: '127.0.0.1',
    importPhoto,
    onEvent: (e) => events.push(e),
    sessionMs: overrides.sessionMs
  })
  return { events, importPhoto, started: server.start() }
}

describe('CaptureServer', () => {
  it('serves the phone page only with the token, under a nonce CSP', async () => {
    const { events, started } = start()
    const { url } = await started
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/c\/[A-Za-z0-9_-]{22}$/)

    const page = await call(url)
    expect(page.status).toBe(200)
    expect(page.body).toContain('Photo for MirrorCat')
    const csp = String(page.headers['content-security-policy'])
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]
    expect(page.body).toContain(`<script nonce="${nonce}">`)
    expect(csp).toContain("default-src 'none'")
    expect(page.headers['cache-control']).toBe('no-store')
    expect(events).toEqual([{ type: 'visited' }])

    const wrong = await call(url.replace(/\/c\/.+$/, '/c/' + 'x'.repeat(22)))
    expect(wrong.status).toBe(404)
    expect(wrong.body).toContain('isn’t active')
    expect((await call(url.replace(/\/c\/.+$/, '/'))).status).toBe(404)
  })

  it('refuses a mismatched Host header (DNS rebinding)', async () => {
    const { started } = start()
    const { url } = await started
    expect((await call(url, { host: 'evil.example:80' })).status).toBe(421)
  })

  it('imports a posted photo and reports it', async () => {
    const { events, importPhoto, started } = start()
    const { url } = await started
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    const reply = await call(`${url}/photo`, { method: 'POST', body: jpeg, type: 'image/jpeg' })
    expect(reply.status).toBe(200)
    expect(importPhoto).toHaveBeenCalledWith(jpeg)
    expect(events).toEqual([{ type: 'uploading' }, { type: 'photo', asset: FAKE_ASSET }])
  })

  it('rejects non-images, oversized bodies and GETs to the upload route', async () => {
    const { importPhoto, started } = start()
    const { url } = await started
    const text = await call(`${url}/photo`, { method: 'POST', body: Buffer.from('hi'), type: 'text/plain' })
    expect(text.status).toBe(415)
    // Declared too large: refused before reading the body.
    const huge = await call(`${url}/photo`, {
      method: 'POST',
      type: 'image/jpeg',
      body: Buffer.alloc(16),
      declaredLength: MAX_CAPTURE_BYTES + 1
    }).catch(() => ({ status: 413 }) as Reply)
    expect(huge.status).toBe(413)
    expect((await call(`${url}/photo`)).status).toBe(405)
    expect(importPhoto).not.toHaveBeenCalled()
  })

  it('passes on a library rejection to the phone and the editor', async () => {
    const { events, started } = start({
      importPhoto: async () => {
        throw new Error('HEIC/AVIF photos aren’t supported yet.')
      }
    })
    const { url } = await started
    const reply = await call(`${url}/photo`, { method: 'POST', body: Buffer.alloc(8), type: 'image/heic' })
    expect(reply.status).toBe(422)
    expect(reply.body).toContain('HEIC')
    expect(events.at(-1)).toEqual({ type: 'rejected', message: 'HEIC/AVIF photos aren’t supported yet.' })
  })

  it('stops answering when stopped, and expires on its own', async () => {
    const first = start()
    const { url } = await first.started
    server!.stop()
    await expect(call(url)).rejects.toThrow()

    const second = start({ sessionMs: 50 })
    const { url: url2 } = await second.started
    await new Promise((r) => setTimeout(r, 120))
    expect(second.events).toContainEqual({ type: 'expired' })
    await expect(call(url2)).rejects.toThrow()
  })
})
