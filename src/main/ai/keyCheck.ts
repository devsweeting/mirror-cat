import type { AiProviderId } from '../../shared/ai'

/** The slice of fetch this needs; Electron's net.fetch in the app, a fake in tests. */
export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal }
) => Promise<{ status: number }>

/**
 * `ok`: the provider accepted the key. `rejected`: it said the key is bad.
 * `unreachable`: no answer either way (offline, timeout, provider error).
 */
export type KeyCheckResult = 'ok' | 'rejected' | 'unreachable'

const TIMEOUT_MS = 10_000

/**
 * A request per provider that needs a valid key but costs nothing:
 *
 * - fal.ai: the pricing lookup, which any authenticated key may call.
 * - Luma (Agents API): has no "who am I" endpoint, so we ask for a
 *   generation that doesn't exist. A good key gets "not found"; a bad,
 *   revoked or expired one gets 401.
 */
export function keyCheckRequest(id: AiProviderId, key: string): { url: string; auth: string } {
  switch (id) {
    case 'luma':
      return {
        url: 'https://agents.lumalabs.ai/v1/generations/00000000-0000-4000-8000-000000000000',
        auth: `Bearer ${key}`
      }
    case 'fal':
      return {
        url: 'https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux/dev',
        auth: `Key ${key}`
      }
  }
}

export async function checkProviderKey(
  id: AiProviderId,
  key: string,
  fetchImpl: FetchLike,
  timeoutMs = TIMEOUT_MS
): Promise<KeyCheckResult> {
  const { url, auth } = keyCheckRequest(id, key)
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: auth, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (res.status === 401 || res.status === 403) return 'rejected'
    // Server errors say nothing about the key.
    if (res.status >= 500) return 'unreachable'
    // 2xx, 404 (Luma's expected answer), 400/422 (request shape) and 429
    // (rate limited) all mean authentication itself passed.
    return 'ok'
  } catch {
    return 'unreachable'
  }
}
