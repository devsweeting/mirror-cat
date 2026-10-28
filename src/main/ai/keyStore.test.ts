import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { KeyStore, type Encryptor } from './keyStore'

// Reversible stand-in for safeStorage: enough to prove the file never
// holds the plain key and that decrypt round-trips.
function fakeCrypto(available = true): Encryptor {
  return {
    isAvailable: () => available,
    encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8').reverse(),
    decrypt: (data) => {
      const text = Buffer.from(data).reverse().toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
      return text.slice(4)
    }
  }
}

const KEY = 'luma-api-0123456789abcdef4f2a'

let dir: string
let path: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mirrorcat-keys-'))
  path = join(dir, 'ai-keys.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('KeyStore', () => {
  it('starts with every provider disconnected', async () => {
    const store = new KeyStore(path, fakeCrypto())
    await store.load()
    expect(store.statuses()).toEqual([
      { id: 'luma', connected: false, last4: null, checkedAt: null, check: null },
      { id: 'fal', connected: false, last4: null, checkedAt: null, check: null }
    ])
  })

  it('stores a key encrypted, reports only its last four, and reloads it', async () => {
    const store = new KeyStore(path, fakeCrypto())
    const status = await store.set('luma', KEY, 'ok')
    expect(status).toMatchObject({ id: 'luma', connected: true, last4: '4f2a', check: 'ok' })
    expect(status.checkedAt).toBeTypeOf('number')
    expect(JSON.stringify(status)).not.toContain(KEY)

    const file = await readFile(path, 'utf8')
    expect(file).not.toContain(KEY)
    expect(file).not.toContain('0123456789abcdef')

    const reloaded = new KeyStore(path, fakeCrypto())
    await reloaded.load()
    expect(reloaded.getKey('luma')).toBe(KEY)
    expect(reloaded.status('luma')).toMatchObject({ connected: true, last4: '4f2a' })
    expect(reloaded.getKey('fal')).toBeNull()
  })

  it('records a key saved offline as unchecked', async () => {
    const store = new KeyStore(path, fakeCrypto())
    expect(await store.set('fal', 'abcd1234:efgh5678', 'unchecked')).toMatchObject({
      check: 'unchecked',
      checkedAt: null,
      last4: '5678'
    })
  })

  it('removes a key from memory and disk', async () => {
    const store = new KeyStore(path, fakeCrypto())
    await store.set('luma', KEY, 'ok')
    expect((await store.remove('luma')).connected).toBe(false)
    const reloaded = new KeyStore(path, fakeCrypto())
    await reloaded.load()
    expect(reloaded.getKey('luma')).toBeNull()
  })

  it('refuses to store anything without secure storage', async () => {
    const store = new KeyStore(path, fakeCrypto(false))
    expect(store.secure).toBe(false)
    await expect(store.set('luma', KEY, 'ok')).rejects.toThrow(/secure storage/i)
    await expect(readFile(path)).rejects.toThrow()
  })

  it('returns null rather than throwing when a key can no longer be decrypted', async () => {
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        keys: { luma: { enc: 'bm9wZQ==', last4: '4f2a', checkedAt: null, check: 'ok' } }
      })
    )
    const store = new KeyStore(path, fakeCrypto())
    await store.load()
    expect(store.status('luma').connected).toBe(true)
    expect(store.getKey('luma')).toBeNull()
  })

  it('drops malformed entries and quarantines an unreadable file', async () => {
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        keys: { luma: { enc: '', last4: 'x' }, openai: { enc: 'abc', last4: '1234' } }
      })
    )
    const store = new KeyStore(path, fakeCrypto())
    await store.load()
    expect(store.statuses().every((s) => !s.connected)).toBe(true)

    await writeFile(path, '{ not json')
    const broken = new KeyStore(path, fakeCrypto())
    await broken.load()
    expect((await readdir(dir)).some((f) => f.startsWith('ai-keys.json.corrupt-'))).toBe(true)
  })
})
