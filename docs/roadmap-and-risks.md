# Roadmap & risks

Grouped by how soon they're likely to matter. "Risk" means something that
will cause a real problem if left; "gap" means a missing feature.

## Next up

- **Media library follow-ups.** Autosave, the shared library, and video
  (MP4/MOV/WebM with Loop/Once) have shipped
  ([media-library.md](media-library.md), decisions 014–017). Still to do:
  - per-surface sound for videos;
  - frame-locked editor/projector playback;
  - orphan-file cleanup on launch;
  - a disk-usage readout;
  - named save-as/export of a scene with its media.
- **Choose the AI provider (open product decision).** Still images or
  video/animation. This shapes the content pipeline, cost per generation,
  and the texture type. See [decision 012](decisions.md#012-ai-generation-behind-a-provider-interface-mocked-for-now).
- **Fold guard for edge nodes (risk).** Dragging a node past its
  neighbours, or across the shape, folds the warp. Constrain each node
  between its neighbours, or warn visually.

## Surface editing

- **Smooth edges.** Edges are straight between nodes. Spline
  interpolation (for example Catmull-Rom through the nodes) would give
  real curves with fewer nodes. `evalEdge()` is the single place to change.
- **Keyboard nudge.** Arrow keys to move the focused corner or node by
  one pixel (or ten with Shift), for fine calibration from across the room.
  Nodes are already focusable; corners need `tabIndex`.
- **Show outline on projector.** An optional toggle for calibrating
  directly on the wall ([decision 010](decisions.md#010-outline-is-editor-only-opacity-is-projected)).
- **Select surfaces by clicking them on the stage.** Today only the
  sidebar selects; ghost outlines aren't clickable.
- **Broader undo.** Shape edits (corners, edge nodes) are undoable ([decision 019](decisions.md#019-undoredo-for-surface-shape-via-a-custom-edit-menu)). Settings, media, reorder and surface deletion aren't yet; deleting a surface is the most painful gap.
- **Shift-drag + edge points (check in with Devin).** Today bends scale
  with the surface. Revisit after real use: keep scaling, clear them, or
  offer both.

## Rendering & performance

- **One WebGL context per surface (risk at scale).** Browsers cap contexts
  at roughly 16 per page. Move to one shared renderer and scene per
  window, with one mesh per surface, before supporting more than about 10
  surfaces.
- **Continuous render loop.** Every engine renders every frame, even when
  idle. Switch to render-on-change for battery and thermals.
- **Full-scene IPC sync.** Batched to one send per frame. Images are now
  referenced by id, so it's small; revisit only at many surfaces.
- **Same image on several surfaces** is decoded and uploaded once per
  surface. Fold into the shared-renderer work above.

## Output & hardware

- **No way out of the output window (risk).** It's frameless and
  fullscreen with no close button. Add Esc to stop projecting.
- **Single-screen testing.** When the chosen display is the laptop's own
  screen, open the output as a normal movable window (a preview) instead
  of fullscreen on top of the editor.
- **Display disconnect (risk).** Nothing listens for
  `screen.on('display-removed')`. If the projector is unplugged, the
  output window is left pointing at a display that no longer exists.
  Close it, or move it back to the primary display.
- **Single output window.** One projector only. Multi-projector setups
  need one output window per display, each showing a subset of surfaces.
- **No color/gamma calibration.** Projectors are dimmer and render color
  differently from monitors.

## Security (must fix before shipping)

- Add a Content-Security-Policy to `src/renderer/index.html` (see the TODO
  there). It must allow `img-src mirrorcat-media:` for the media library.
- Enable `sandbox: true` on both windows. The preload only uses
  `contextBridge` and `ipcRenderer`, both of which are sandbox-compatible.
- Keep any provider API key in the main process via `safeStorage`; never
  expose it to the renderer.

## Engineering hygiene

- **No automated tests yet.** `src/shared/surfaceGeometry.ts` is pure and
  dependency-free, and is the first candidate: a Vitest suite for "no
  nodes equals bilinear", "patch passes through nodes", and insert/remove
  rules. These were checked by hand during the edge-node work.
- **No CI.** Typecheck plus lint plus geometry tests on each push would
  catch most regressions.
