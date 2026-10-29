# Roadmap & risks

Grouped by how soon they're likely to matter. "Risk" means something that
will cause a real problem if left; "gap" means a missing feature.

## Next up

- **Media library follow-ups.** Autosave, the shared library, and video
  (MP4/MOV/WebM with Loop/Once) have shipped
  ([media-library.md](media-library.md), decisions 014–017). Still to do:
  - per-surface sound for videos;
  - frame-locked editor/projector playback;
  - a disk-usage readout;
  - named save-as/export of a scene with its media.
- **Choose the AI provider (open product decision).** Still images or
  video/animation. This shapes the content pipeline, cost per generation,
  and the texture type. See [decision 012](decisions.md#012-ai-generation-behind-a-provider-interface-mocked-for-now).
- **Fold guard for edge nodes (risk).** Dragging a node past its
  neighbours, or across the shape, folds the warp. Constrain each node
  between its neighbours, or warn visually.

- **Scan an object (exploring).** Phone photo via QR → background
  removed → a masked surface that already lines up. Step 1, surface masks,
  has shipped ([decision 024](decisions.md#024-surface-masks-uv-space-images-distance-fields-painted-on-the-stage)).
  Next: phone capture over the LAN (QR), tap-to-select segmentation (SAM 2
  / BiRefNet, local), registration from projected ArUco markers. Later:
  Gray-code structured light for per-pixel fit on non-flat objects.
  Mask follow-ups: undo for mask changes, a "grid on masked area only"
  option, smoother brush (pressure, soft brush).

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
  at roughly 16 per page. Contexts are now released on dispose and a lost
  context recovers, but more than ~15 visible surfaces will still lose
  the oldest. Move to one shared renderer and scene per window, with one
  mesh per surface, before supporting more than about 10 surfaces.
- **Playing video keeps its surface redrawing every frame** (static
  content renders only on change). A paused or finished video stops.
- **Full-scene IPC sync.** Batched to one send per frame. Images are now
  referenced by id, so it's small; revisit only at many surfaces.
- **Same image on several surfaces** is decoded and uploaded once per
  surface. Fold into the shared-renderer work above.

## Output & hardware

- **Single-screen testing.** Going live on the laptop's own screen now
  asks first and Esc gets you out, but a movable preview window would be
  friendlier for testing without a projector.
- **Single output window.** One projector only. Multi-projector setups
  need one output window per display, each showing a subset of surfaces.
- **No color/gamma calibration.** Projectors are dimmer and render color
  differently from monitors.

## Security

Sandbox, CSP, IPC sender checks, navigation lock and fuses are done
([decision 020](decisions.md#020-phase-1-hardening-sandbox-csp-ipc-trust-fuses)).
Still to do:

- Keep any provider API key in the main process via `safeStorage`; never
  expose it to the renderer. When a provider is added, its host goes in
  the CSP's `connect-src` only if the renderer calls it directly (prefer
  calling from main).
- Upgrade Electron to 45+ for a moderate WebHID/WebUSB permission
  advisory (unused by the app, so low urgency).
- Code signing and notarization for distributed builds.

## Engineering hygiene

- **Tests and CI are in** ([decision 021](decisions.md#021-tests-vitest-for-logic-playwright-for-the-built-app)).
  Gaps: no unit tests for React components or `ProjectionEngine`; the e2e
  smoke test doesn't cover going live, drag-and-drop or video playback;
  CI doesn't run the e2e test (it needs a display).
- **Autosave recovery is manual.** `scene.prev.json` keeps the launch-time
  scene, and loads automatically only when `scene.json` is missing or
  corrupt. An in-app "restore previous session" would make it usable.
