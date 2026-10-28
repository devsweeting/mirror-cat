import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ANIMATION_SETTINGS,
  MAX_ASK_ABOVE_USD,
  estimateAnimationUsd,
  isAiProviderId,
  normalizeAnimationSettings,
  validateKeyInput
} from './ai'

describe('validateKeyInput', () => {
  it('trims copy-paste whitespace and accepts a plausible key', () => {
    expect(validateKeyInput('  luma-api-abc123def456\n')).toEqual({
      ok: true,
      key: 'luma-api-abc123def456'
    })
  })

  it('rejects empty, short, spaced, control-character and oversized input', () => {
    expect(validateKeyInput('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(validateKeyInput('abc')).toEqual({ ok: false, reason: 'format' })
    expect(validateKeyInput('luma-api abc123')).toEqual({ ok: false, reason: 'format' })
    expect(validateKeyInput('luma-api-\u0000abc123')).toEqual({ ok: false, reason: 'format' })
    expect(validateKeyInput('x'.repeat(513))).toEqual({ ok: false, reason: 'too-long' })
    expect(validateKeyInput(42)).toEqual({ ok: false, reason: 'format' })
  })
})

describe('normalizeAnimationSettings', () => {
  it('fills defaults from nothing', () => {
    expect(normalizeAnimationSettings(undefined)).toEqual(DEFAULT_ANIMATION_SETTINGS)
  })

  it('applies valid fields of a partial patch and ignores the rest', () => {
    const base = DEFAULT_ANIMATION_SETTINGS
    expect(
      normalizeAnimationSettings(
        { model: 'fal/kling-3.0-pro', loopSeconds: 7, quality: '4k', extra: true },
        base
      )
    ).toEqual({ ...base, model: 'fal/kling-3.0-pro' })
    expect(normalizeAnimationSettings({ loopSeconds: 10, quality: 'draft' }, base)).toMatchObject({
      loopSeconds: 10,
      quality: 'draft'
    })
  })

  it('clamps and rounds the spend prompt', () => {
    const n = (askAboveUsd: unknown) => normalizeAnimationSettings({ askAboveUsd }).askAboveUsd
    expect(n(2.345)).toBe(2.35)
    expect(n(-3)).toBe(0)
    expect(n(1e9)).toBe(MAX_ASK_ABOVE_USD)
    expect(n(Number.NaN)).toBe(DEFAULT_ANIMATION_SETTINGS.askAboveUsd)
    expect(n('5')).toBe(DEFAULT_ANIMATION_SETTINGS.askAboveUsd)
  })
})

describe('estimateAnimationUsd', () => {
  it('uses published Luma prices and leaves per-request providers blank', () => {
    expect(estimateAnimationUsd(DEFAULT_ANIMATION_SETTINGS)).toBe(0.3)
    expect(
      estimateAnimationUsd({ ...DEFAULT_ANIMATION_SETTINGS, loopSeconds: 10, quality: '1080p' })
    ).toBe(3.6)
    expect(
      estimateAnimationUsd({ ...DEFAULT_ANIMATION_SETTINGS, model: 'fal/seedance-2.0' })
    ).toBeNull()
  })
})

describe('isAiProviderId', () => {
  it('knows only the supported providers', () => {
    expect(isAiProviderId('luma')).toBe(true)
    expect(isAiProviderId('fal')).toBe(true)
    expect(isAiProviderId('openai')).toBe(false)
    expect(isAiProviderId(undefined)).toBe(false)
  })
})
