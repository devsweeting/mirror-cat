import { app, net } from 'electron'
import { join } from 'path'
import { createControlWindow, getControlWindow } from './windows/controlWindow'
import { closeOutputWindow } from './windows/outputWindow'
import { registerIpcHandlers } from './ipc/handlers'
import { installAppMenu } from './appMenu'
import { watchDisplays } from './displays'
import { MediaLibrary } from './media/mediaLibrary'
import { registerMediaProtocol, registerMediaSchemePrivileges } from './media/protocol'
import { SceneAutosave } from './persistence/sceneAutosave'
import { MaskStore } from './masks/maskStore'
import { KeyStore, type Encryptor } from './ai/keyStore'
import { electronEncryptor } from './ai/electronEncryptor'
import { AiSettingsStore } from './ai/aiSettingsStore'
import type { FetchLike } from './ai/keyCheck'
import { registerAiHandlers } from './ipc/aiHandlers'

// Point the library + autosave at a scratch folder for tests and demos
// without touching your real data: MIRRORCAT_USER_DATA=/tmp/x npm run dev
// Development builds only -- a packaged app ignores it.
if (!app.isPackaged && process.env.MIRRORCAT_USER_DATA) {
  app.setPath('userData', process.env.MIRRORCAT_USER_DATA)
}

// Custom schemes have to be declared before the app is ready.
registerMediaSchemePrivileges()

let autosave: SceneAutosave | null = null

app.whenReady().then(async () => {
  const userData = app.getPath('userData')

  const library = new MediaLibrary(join(userData, 'media'))
  await library.init()
  const masks = new MaskStore(join(userData, 'masks'))
  await masks.init()
  registerMediaProtocol(library, masks)

  autosave = new SceneAutosave(join(userData, 'scene.json'))
  const savedSurfaces = await autosave.load()
  // Painting saves a new mask every few strokes; drop the ones no saved
  // scene (or its backup) still uses. Skipped if scene.json is unreadable.
  const masksInUse = await autosave.maskIdsInUse()
  if (masksInUse) {
    for (const surface of savedSurfaces ?? []) if (surface.mask) masksInUse.add(surface.mask.id)
    const removed = await masks.sweep(masksInUse).catch(() => 0)
    if (removed > 0) console.log(`[masks] swept ${removed} unused mask file(s)`)
  }

  const devAi = devAiOverrides()
  const keys = new KeyStore(join(userData, 'ai-keys.json'), devAi.encryptor ?? electronEncryptor())
  await keys.load()
  const aiSettings = new AiSettingsStore(join(userData, 'ai-settings.json'))
  await aiSettings.load()

  // Handlers before the window, so the renderer's first invoke can't race them.
  registerIpcHandlers({ library, masks, autosave, savedSurfaces })
  registerAiHandlers({
    keys,
    settings: aiSettings,
    fetchImpl: devAi.fetchImpl ?? ((url, init) => net.fetch(url, init))
  })
  installAppMenu()
  watchDisplays()
  createControlWindow()

  // Dock click on macOS: reopen the editor if it's gone. Checks for the
  // editor specifically, not "any window" -- the projector window counts as
  // a window but can't be used to edit anything.
  app.on('activate', () => {
    if (!getControlWindow()) createControlWindow()
  })
})

// Write the last debounced change -- and let any write already under way
// finish -- before exiting, so a quick edit-then-quit isn't lost.
app.on('before-quit', (event) => {
  if (!autosave?.hasPendingWrite) return
  event.preventDefault()
  const pending = autosave
  void pending.close().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  closeOutputWindow()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * Test hooks for Settings › AI, development builds only (a packaged app
 * ignores them), so e2e runs never touch the real Keychain or network:
 *
 * - MIRRORCAT_AI_FAKE_CRYPTO=1: keys "encrypted" with a reversible stand-in.
 * - MIRRORCAT_AI_KEYCHECK=accept|reject|offline: canned key-check answers.
 */
function devAiOverrides(): { encryptor?: Encryptor; fetchImpl?: FetchLike } {
  if (app.isPackaged) return {}
  const out: { encryptor?: Encryptor; fetchImpl?: FetchLike } = {}
  if (process.env.MIRRORCAT_AI_FAKE_CRYPTO === '1') {
    out.encryptor = {
      isAvailable: () => true,
      encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
      decrypt: (data) => Buffer.from(data).reverse().toString('utf8')
    }
  }
  const check = process.env.MIRRORCAT_AI_KEYCHECK
  if (check === 'accept' || check === 'reject' || check === 'offline') {
    out.fetchImpl = async () => {
      if (check === 'offline') throw new Error('offline')
      return { status: check === 'accept' ? 404 : 401 }
    }
  }
  return out
}
