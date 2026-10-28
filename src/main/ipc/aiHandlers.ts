import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { isAiProviderId, validateKeyInput, type AiState, type SetKeyResult } from '../../shared/ai'
import type { KeyStore } from '../ai/keyStore'
import type { AiSettingsStore } from '../ai/aiSettingsStore'
import { checkProviderKey, type FetchLike } from '../ai/keyCheck'
import { requireControlWindow } from './trust'

interface AiHandlerDeps {
  keys: KeyStore
  settings: AiSettingsStore
  fetchImpl: FetchLike
}

/**
 * Settings › AI & animation. Every channel is control-window only -- the
 * projector has no reason to see even key statuses. Keys come in once
 * (AiSetKey) and never go back out: replies carry statuses only.
 */
export function registerAiHandlers({ keys, settings, fetchImpl }: AiHandlerDeps): void {
  ipcMain.handle(IpcChannels.AiGetState, (event): AiState => {
    requireControlWindow(event)
    return { providers: keys.statuses(), settings: settings.get(), secureStorage: keys.secure }
  })

  ipcMain.handle(
    IpcChannels.AiSetKey,
    async (event, id: unknown, rawKey: unknown): Promise<SetKeyResult> => {
      requireControlWindow(event)
      if (!isAiProviderId(id)) throw new Error('Unknown provider')
      const input = validateKeyInput(rawKey)
      if (!input.ok) return { ok: false, reason: input.reason }
      if (!keys.secure) return { ok: false, reason: 'insecure' }

      const result = await checkProviderKey(id, input.key, fetchImpl)
      if (result === 'rejected') return { ok: false, reason: 'rejected' }
      // Offline or the provider is having trouble: keep the key and say it
      // wasn't checked, rather than make someone paste it again later.
      const status = await keys.set(id, input.key, result === 'ok' ? 'ok' : 'unchecked')
      return { ok: true, status }
    }
  )

  ipcMain.handle(IpcChannels.AiRemoveKey, (event, id: unknown) => {
    requireControlWindow(event)
    if (!isAiProviderId(id)) throw new Error('Unknown provider')
    return keys.remove(id)
  })

  ipcMain.handle(IpcChannels.AiUpdateSettings, (event, patch: unknown) => {
    requireControlWindow(event)
    return settings.update(patch)
  })
}
