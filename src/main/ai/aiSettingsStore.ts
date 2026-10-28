import { promises as fs } from 'fs'
import {
  DEFAULT_ANIMATION_SETTINGS,
  normalizeAnimationSettings,
  type AnimationSettings
} from '../../shared/ai'
import { isNotFound, quarantine, writeFileAtomic } from '../fsUtil'

/** Animation defaults (model, loop length, quality, spend prompt) in userData/ai-settings.json. */
export class AiSettingsStore {
  private settings: AnimationSettings = { ...DEFAULT_ANIMATION_SETTINGS }
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const text = await fs.readFile(this.path, 'utf8')
      this.settings = normalizeAnimationSettings(JSON.parse(text))
    } catch (error) {
      if (isNotFound(error)) return
      const moved = await quarantine(this.path)
      console.error(`[ai] ai-settings.json unreadable, moved to ${moved}`)
    }
  }

  get(): AnimationSettings {
    return { ...this.settings }
  }

  /** Applies the valid parts of an untrusted patch and saves. */
  async update(patch: unknown): Promise<AnimationSettings> {
    this.settings = normalizeAnimationSettings(patch, this.settings)
    const data = JSON.stringify(this.settings, null, 2)
    this.writing = this.writing.catch(() => undefined).then(() => writeFileAtomic(this.path, data))
    await this.writing
    return this.get()
  }
}
