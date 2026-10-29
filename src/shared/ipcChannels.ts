export const IpcChannels = {
  GetDisplays: 'displays:get',
  /** Main → control window: a display was plugged in, removed or changed size. */
  DisplaysChanged: 'displays:changed',
  OpenOutputWindow: 'output:open',
  CloseOutputWindow: 'output:close',
  /** Main → control window: the projector window closed (Esc, display gone, or Stop). */
  OutputClosed: 'output:closed',
  SceneUpdate: 'scene:update',
  SceneRequestSync: 'scene:request-sync',
  /** Surfaces from the last autosave, read once by the control window on launch. */
  SceneLoadSaved: 'scene:load-saved',
  /** Main → control window: Edit ▸ Undo / Redo (⌘Z / ⇧⌘Z) was used. */
  EditCommand: 'edit:command',

  MediaList: 'media:list',
  MediaPickAndImport: 'media:pick-and-import',
  MediaImportPaths: 'media:import-paths',
  MediaImportGenerated: 'media:import-generated',
  MediaRename: 'media:rename',
  MediaDelete: 'media:delete',
  /** Renderer → main: size, duration, playability and thumbnail it measured. */
  MediaAttachProbe: 'media:attach-probe',
  /** Broadcast to every window with the full asset list whenever it changes. */
  MediaChanged: 'media:changed',

  /** Control window → main: store a mask PNG, get its id back. */
  MaskSave: 'mask:save',
  /** Control window → main: native file dialog for a mask image; returns its bytes. */
  MaskPickImage: 'mask:pick-image',
  /** Main → control window: Edit ▸ Edit Mask (⇧⌘M) toggles mask mode. */
  MaskToggleEdit: 'mask:toggle-edit',

  /** Main → control window: open Settings (app menu, ⌘,). */
  SettingsOpen: 'settings:open',
  AiGetState: 'ai:get-state',
  AiSetKey: 'ai:set-key',
  AiRemoveKey: 'ai:remove-key',
  AiUpdateSettings: 'ai:update-settings'
} as const
