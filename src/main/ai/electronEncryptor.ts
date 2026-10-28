import { safeStorage } from 'electron'
import type { Encryptor } from './keyStore'

/** safeStorage-backed Encryptor: macOS Keychain, Windows DPAPI, Linux keyring. */
export function electronEncryptor(): Encryptor {
  return {
    isAvailable: () => {
      if (!safeStorage.isEncryptionAvailable()) return false
      // On Linux without a keyring, safeStorage falls back to a hard-coded
      // password ("basic_text") -- obfuscation, not protection. Refuse it.
      return (
        process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
      )
    },
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  }
}
