/** ⌘ on a Mac, Ctrl elsewhere -- for showing shortcuts. */
export const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

/** The platform's command modifier is held (⌘ on a Mac, Ctrl elsewhere). */
export function hasMod(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return MOD_KEY === '⌘' ? event.metaKey : event.ctrlKey
}

/** Typing into a field or choosing in a list: leave keys to it. */
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}
