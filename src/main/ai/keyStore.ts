import { promises as fs } from 'fs'
import {
  AI_PROVIDER_IDS,
  isAiProviderId,
  type AiProviderId,
  type AiProviderStatus,
  type KeyCheck
} from '../../shared/ai'
import { isNotFound, quarantine, writeFileAtomic } from '../fsUtil'

/**
 * Encrypts and decrypts key strings. In the app this is Electron's
 * safeStorage (macOS Keychain, Windows DPAPI, libsecret/kwallet on Linux);
 * tests pass a fake.
 */
export interface Encryptor {
  /** False when keys can't be protected on this machine -- then nothing is stored. */
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

interface StoredKey {
  /** safeStorage ciphertext, base64. */
  enc: string
  last4: string
  checkedAt: number | null
  check: KeyCheck
}

interface KeyFile {
  version: 1
  keys: Partial<Record<AiProviderId, StoredKey>>
}

/**
 * Provider API keys, encrypted at rest in userData/ai-keys.json.
 *
 * The renderer gets `statuses()` only -- last four characters and whether
 * it was accepted -- never a key, not even the one it just saved.
 * `getKey()` is for main's own provider calls.
 */
export class KeyStore {
  private keys: Partial<Record<AiProviderId, StoredKey>> = {}
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly crypto: Encryptor
  ) {}

  get secure(): boolean {
    return this.crypto.isAvailable()
  }

  async load(): Promise<void> {
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (error) {
      if (isNotFound(error)) return
      throw error
    }
    try {
      const parsed = JSON.parse(text) as Partial<KeyFile>
      const keys: KeyFile['keys'] = {}
      for (const [id, entry] of Object.entries(parsed.keys ?? {})) {
        if (isAiProviderId(id) && isStoredKey(entry)) keys[id] = entry
      }
      this.keys = keys
    } catch {
      const moved = await quarantine(this.path)
      console.error(`[ai] ai-keys.json unreadable, moved to ${moved}`)
    }
  }

  statuses(): AiProviderStatus[] {
    return AI_PROVIDER_IDS.map((id) => this.status(id))
  }

  status(id: AiProviderId): AiProviderStatus {
    const entry = this.keys[id]
    return entry
      ? { id, connected: true, last4: entry.last4, checkedAt: entry.checkedAt, check: entry.check }
      : { id, connected: false, last4: null, checkedAt: null, check: null }
  }

  async set(id: AiProviderId, key: string, check: KeyCheck): Promise<AiProviderStatus> {
    if (!this.crypto.isAvailable()) throw new Error('Secure storage is not available')
    this.keys[id] = {
      enc: this.crypto.encrypt(key).toString('base64'),
      last4: key.slice(-4),
      checkedAt: check === 'ok' ? Date.now() : null,
      check
    }
    await this.save()
    return this.status(id)
  }

  async remove(id: AiProviderId): Promise<AiProviderStatus> {
    if (this.keys[id]) {
      delete this.keys[id]
      await this.save()
    }
    return this.status(id)
  }

  /**
   * The decrypted key, for main's own requests. Null if none is stored or
   * it can no longer be decrypted (e.g. the OS keychain entry was reset).
   */
  getKey(id: AiProviderId): string | null {
    const entry = this.keys[id]
    if (!entry || !this.crypto.isAvailable()) return null
    try {
      return this.crypto.decrypt(Buffer.from(entry.enc, 'base64'))
    } catch {
      return null
    }
  }

  /** Writes one at a time, newest state wins. */
  private save(): Promise<void> {
    const file: KeyFile = { version: 1, keys: this.keys }
    const data = JSON.stringify(file, null, 2)
    this.writing = this.writing.catch(() => undefined).then(() => writeFileAtomic(this.path, data))
    return this.writing
  }
}

function isStoredKey(value: unknown): value is StoredKey {
  const v = value as StoredKey
  return (
    !!v &&
    typeof v.enc === 'string' &&
    v.enc.length > 0 &&
    typeof v.last4 === 'string' &&
    v.last4.length <= 4 &&
    (v.checkedAt === null || (typeof v.checkedAt === 'number' && Number.isFinite(v.checkedAt))) &&
    (v.check === 'ok' || v.check === 'unchecked')
  )
}
