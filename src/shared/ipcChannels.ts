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

  /** Control window → main: open a scan link (phone capture); returns the QR code. */
  CaptureStart: 'capture:start',
  CaptureStop: 'capture:stop',
  /** Main → control window: the phone opened the page, sent a photo, etc. */
  CaptureEvent: 'capture:event',
  /** Control window → main: show or hide the scan pattern on the projector. */
  CapturePattern: 'capture:pattern',
  /** Main → output window: draw (or stop drawing) the scan pattern. */
  CapturePatternShow: 'capture:pattern-show',
  /** Control window → main: find the projector frame in a scan photo. */
  CaptureDetectFrame: 'capture:detect-frame',
  /** Control window → main: straighten the frame's part of an image into a frame-sized image. */
  CaptureRectify: 'capture:rectify',
  /** Control window → main: find flat shapes in a fitted scan image. */
  CaptureFindShapes: 'capture:find-shapes',
  /** Control window → main: an exact mask for a found shape on a surface with given corners. */
  CaptureShapeMask: 'capture:shape-mask',
  /** Control window → main: run the detailed finder (SAM 2) over a fitted scan for more shapes. */
  CaptureFindMore: 'capture:find-more',
  /** Control window → main: the shape inside a box drawn on a fitted scan. */
  CaptureFindInBox: 'capture:find-in-box',
  /** Control window → main: is the detailed finder's model here? */
  SamStatus: 'sam:status',
  /** Control window → main: download the detailed finder's model (resolves when done). */
  SamDownload: 'sam:download',
  /** Control window → main: stop that download. */
  SamCancel: 'sam:cancel',
  /** Main → control window: download progress / status changes. */
  SamProgress: 'sam:progress',
  /** Main → control window: the projector window is now on a different display. */
  OutputDisplayChanged: 'output:display-changed',

  /** Main → control window: open Settings (app menu, ⌘,). */
  SettingsOpen: 'settings:open',
  AiGetState: 'ai:get-state',
  AiSetKey: 'ai:set-key',
  AiRemoveKey: 'ai:remove-key',
  AiUpdateSettings: 'ai:update-settings'
} as const
