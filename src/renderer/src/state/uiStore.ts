import { create } from 'zustand'

/**
 * Control-window UI state that several components need but that is never
 * synced to the projector or saved with the scene.
 */
interface UiStore {
  libraryOpen: boolean
  setLibraryOpen: (open: boolean) => void
  toggleLibrary: () => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  scanOpen: boolean
  setScanOpen: (open: boolean) => void
}

const LIBRARY_OPEN_KEY = 'mirrorcat.libraryOpen'

function readLibraryOpen(): boolean {
  try {
    return localStorage.getItem(LIBRARY_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeLibraryOpen(open: boolean): void {
  try {
    localStorage.setItem(LIBRARY_OPEN_KEY, open ? '1' : '0')
  } catch {
    // Remembering the panel is a convenience; ignore storage failures.
  }
}

export const useUiStore = create<UiStore>((set, get) => ({
  libraryOpen: readLibraryOpen(),
  setLibraryOpen: (open) => {
    writeLibraryOpen(open)
    set({ libraryOpen: open })
  },
  toggleLibrary: () => get().setLibraryOpen(!get().libraryOpen),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  scanOpen: false,
  setScanOpen: (open) => set({ scanOpen: open })
}))
