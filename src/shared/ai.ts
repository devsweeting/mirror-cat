/**
 * AI providers, models and animation defaults -- the parts both processes
 * need. Keys themselves never appear here: they live encrypted in main
 * (main/ai/keyStore.ts) and the renderer only ever sees an
 * AiProviderStatus. See docs/ai-settings.md.
 */

export type AiProviderId = 'luma' | 'fal'

export const AI_PROVIDER_IDS: readonly AiProviderId[] = ['luma', 'fal']

export interface AiProviderInfo {
  id: AiProviderId
  name: string
  /** One line under the name in Settings. */
  tagline: string
  keyPlaceholder: string
  /** Where to create a key. Opened in the OS browser. */
  getKeyUrl: string
  /** Shown when the provider rejects a key, if its keys have a known prefix. */
  keyPrefix?: string
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  luma: {
    id: 'luma',
    name: 'Luma',
    tagline: 'Ray 3.2 · built-in seamless loop',
    keyPlaceholder: 'luma-api-…',
    getKeyUrl: 'https://platform.lumalabs.ai/',
    keyPrefix: 'luma-api-'
  },
  fal: {
    id: 'fal',
    name: 'fal.ai',
    tagline: 'One key for Kling, Seedance and Veo',
    keyPlaceholder: 'Paste your fal.ai key',
    getKeyUrl: 'https://fal.ai/dashboard/keys'
  }
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

/**
 * `ok`: the provider accepted the key when it was saved. `unchecked`: saved
 * while the provider couldn't be reached; it's checked again on first use.
 */
export type KeyCheck = 'ok' | 'unchecked'

/** Everything the renderer may know about a stored key. Never the key. */
export interface AiProviderStatus {
  id: AiProviderId
  connected: boolean
  /** Last four characters, so you can tell which key it is. */
  last4: string | null
  /** When the provider last accepted it (ms since epoch). */
  checkedAt: number | null
  check: KeyCheck | null
}

// ---------------------------------------------------------------------------
// Models and animation defaults
// ---------------------------------------------------------------------------

export type AiQuality = 'draft' | '720p' | '1080p'
export const AI_QUALITIES: readonly AiQuality[] = ['draft', '720p', '1080p']

export type AiLoopSeconds = 5 | 10
export const AI_LOOP_SECONDS: readonly AiLoopSeconds[] = [5, 10]

export type AiModelId =
  'luma/ray-3.2' | 'fal/kling-3.0-pro' | 'fal/seedance-2.0' | 'fal/veo-3.1-fast'

export interface AiModelInfo {
  id: AiModelId
  provider: AiProviderId
  label: string
  /** How it loops: a native loop option, or the same image as first and last frame. */
  loop: 'native' | 'first-last-frame'
  /**
   * Published price in USD by loop length and quality, where it's fixed
   * and known. Missing: the provider quotes per request (fal.ai has a
   * pricing API; wired up with generation).
   */
  priceUsd?: Record<AiLoopSeconds, Record<AiQuality, number>>
}

export const AI_MODELS: readonly AiModelInfo[] = [
  {
    id: 'luma/ray-3.2',
    provider: 'luma',
    label: 'Ray 3.2',
    loop: 'native',
    // Luma Agents API pay-as-you-go, standard dynamic range (Oct 2026).
    // "Draft" is Luma's 360p tier.
    priceUsd: {
      5: { draft: 0.06, '720p': 0.3, '1080p': 1.2 },
      10: { draft: 0.18, '720p': 0.9, '1080p': 3.6 }
    }
  },
  { id: 'fal/kling-3.0-pro', provider: 'fal', label: 'Kling 3.0 Pro', loop: 'first-last-frame' },
  { id: 'fal/seedance-2.0', provider: 'fal', label: 'Seedance 2.0', loop: 'first-last-frame' },
  { id: 'fal/veo-3.1-fast', provider: 'fal', label: 'Veo 3.1 Fast', loop: 'first-last-frame' }
]

export function findAiModel(id: AiModelId): AiModelInfo {
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[0]
}

export interface AnimationSettings {
  model: AiModelId
  loopSeconds: AiLoopSeconds
  quality: AiQuality
  /** Ask for confirmation before an animation estimated above this (USD). */
  askAboveUsd: number
}

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  model: 'luma/ray-3.2',
  loopSeconds: 5,
  quality: '720p',
  askAboveUsd: 1
}

export const MAX_ASK_ABOVE_USD = 100

/**
 * Merge an untrusted (possibly partial) settings object onto `base`,
 * keeping only valid fields. Used for loading from disk and for IPC
 * updates from the renderer.
 */
export function normalizeAnimationSettings(
  value: unknown,
  base: AnimationSettings = DEFAULT_ANIMATION_SETTINGS
): AnimationSettings {
  const next = { ...base }
  if (!value || typeof value !== 'object') return next
  const v = value as Partial<Record<keyof AnimationSettings, unknown>>
  if (AI_MODELS.some((m) => m.id === v.model)) next.model = v.model as AiModelId
  if ((AI_LOOP_SECONDS as readonly unknown[]).includes(v.loopSeconds)) {
    next.loopSeconds = v.loopSeconds as AiLoopSeconds
  }
  if ((AI_QUALITIES as readonly unknown[]).includes(v.quality))
    next.quality = v.quality as AiQuality
  if (typeof v.askAboveUsd === 'number' && Number.isFinite(v.askAboveUsd)) {
    const clamped = Math.min(MAX_ASK_ABOVE_USD, Math.max(0, v.askAboveUsd))
    next.askAboveUsd = Math.round(clamped * 100) / 100
  }
  return next
}

/** Published price for one animation with these settings, or null if quoted per request. */
export function estimateAnimationUsd(settings: AnimationSettings): number | null {
  const prices = findAiModel(settings.model).priceUsd
  return prices ? prices[settings.loopSeconds][settings.quality] : null
}

// ---------------------------------------------------------------------------
// Keys and IPC payloads
// ---------------------------------------------------------------------------

/** Generous: real keys are well under this. Bounds what main will store. */
export const MAX_KEY_LENGTH = 512
const MIN_KEY_LENGTH = 8

export type KeyInputProblem = 'empty' | 'format' | 'too-long'

/**
 * Cheap local sanity check before anything touches the network: trims
 * surrounding whitespace (a common copy-paste artifact) and rejects
 * anything that can't be a key -- inner whitespace, control characters,
 * absurd lengths.
 */
export function validateKeyInput(
  raw: unknown
): { ok: true; key: string } | { ok: false; reason: KeyInputProblem } {
  if (typeof raw !== 'string') return { ok: false, reason: 'format' }
  const key = raw.trim()
  if (key.length === 0) return { ok: false, reason: 'empty' }
  if (key.length > MAX_KEY_LENGTH) return { ok: false, reason: 'too-long' }
  if (key.length < MIN_KEY_LENGTH || /[\s\x00-\x1f\x7f]/.test(key)) {
    return { ok: false, reason: 'format' }
  }
  return { ok: true, key }
}

export interface AiState {
  providers: AiProviderStatus[]
  settings: AnimationSettings
  /** False when this computer can't encrypt keys; Settings then refuses to store one. */
  secureStorage: boolean
}

export type SetKeyResult =
  | { ok: true; status: AiProviderStatus }
  | { ok: false; reason: KeyInputProblem | 'rejected' | 'insecure' }
