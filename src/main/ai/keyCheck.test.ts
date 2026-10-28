import { describe, expect, it } from 'vitest'
import { checkProviderKey, keyCheckRequest, type FetchLike } from './keyCheck'

function respond(status: number): FetchLike {
  return async () => ({ status })
}

describe('keyCheckRequest', () => {
  it('uses each provider’s auth scheme and a free endpoint', () => {
    expect(keyCheckRequest('luma', 'k')).toEqual({
      url: expect.stringMatching(/^https:\/\/agents\.lumalabs\.ai\/v1\/generations\//),
      auth: 'Bearer k'
    })
    expect(keyCheckRequest('fal', 'k')).toEqual({
      url: expect.stringMatching(/^https:\/\/api\.fal\.ai\/v1\/models\/pricing\?/),
      auth: 'Key k'
    })
  })
})

describe('checkProviderKey', () => {
  it('sends the key only in the Authorization header', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null
    const spy: FetchLike = async (url, init) => {
      seen = { url, headers: init.headers }
      return { status: 404 }
    }
    await checkProviderKey('luma', 'luma-api-secret', spy)
    expect(seen!.url).not.toContain('secret')
    expect(seen!.headers.Authorization).toBe('Bearer luma-api-secret')
  })

  it('treats 401/403 as a rejected key', async () => {
    expect(await checkProviderKey('luma', 'k', respond(401))).toBe('rejected')
    expect(await checkProviderKey('fal', 'k', respond(403))).toBe('rejected')
  })

  it('treats answers that got past auth as ok', async () => {
    for (const status of [200, 400, 404, 422, 429]) {
      expect(await checkProviderKey('luma', 'k', respond(status))).toBe('ok')
    }
  })

  it('treats server errors, network failures and timeouts as unreachable', async () => {
    expect(await checkProviderKey('fal', 'k', respond(503))).toBe('unreachable')
    const offline: FetchLike = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await checkProviderKey('fal', 'k', offline)).toBe('unreachable')
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    expect(await checkProviderKey('luma', 'k', hang, 20)).toBe('unreachable')
  })
})
