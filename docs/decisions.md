# Decisions

A log of the significant technical and product decisions, with what was
considered and why. **Append-only:** when a decision changes, add a new
entry that supersedes the old one rather than editing history.

Format: context → decision → alternatives considered → consequences.

---

## 001 Electron with electron-vite
*2026-09-01 · Accepted*

**Context.** A home projection-mapping tool needs a fullscreen, borderless
window on a second display, plus GPU rendering. A browser tab can't
reliably do the first.

**Decision.** Electron, built with electron-vite (React + TypeScript
template).

**Alternatives.**
- Electron Forge: a stronger official packaging story, but a slower dev
  loop for UI-heavy, canvas-heavy iteration.
- A plain web app: can't own a second display fullscreen.

**Consequences.** Fast hot reload. Packaging goes through
electron-builder (`build:mac`, `build:win`, `build:linux`). Vite is
pinned to 7 until electron-vite supports 8.

## 002 Three.js / WebGL for rendering
*2026-09-01 · Accepted*

**Context.** The core value is warping a flat image onto an off-axis,
non-rectangular real surface.

**Decision.** Three.js with an orthographic camera and a subdivided mesh.

**Alternatives.** Canvas2D. Simpler, but it only has affine transforms,
so it can't do true keystone or corner-pin warping.

**Consequences.** Real GPU warping and texture filtering, and room for
video or shader content later. It costs one WebGL context per surface
today (see 006 and the roadmap).

## 003 Two windows: control and output
*2026-09-01 · Accepted*

**Context.** Calibration happens by watching the wall while editing on
the laptop.

**Decision.** A normal control window, plus a frameless fullscreen output
window on the chosen display. Both load the same renderer bundle and are
routed by URL hash.

**Consequences.** State has to be synced across processes (see 004). Only
one output window exists, so there's one projector for now.

## 004 One zustand store, full-scene sync over IPC
*2026-09-01 · Accepted*

**Context.** The output window must mirror the editor exactly.

**Decision.** The control window's zustand store is the single source of
truth. The full `SceneState` is sent to main, which caches it and forwards
it to output. Sends are batched to one per animation frame. A reopened
output window pulls the cache.

**Alternatives.** Sending diffs or patches is more efficient, but more
code and more ways to drift out of sync.

**Consequences.** Simple and correct. The cost grows with image size,
because base64 content is re-sent on every edit, including a drag. That's
fine for a few surfaces; revisit when content becomes large or animated.

## 005 Normalized 0–1 coordinates for all surface geometry
*2026-09-01 · Accepted*

**Decision.** Corners and edge nodes are stored as fractions of the
projector frame, never as pixels.

**Consequences.** The same scene renders correctly at any size, in the
editor preview and on the projector, with no conversion. It requires the
editor frame to match the projector's aspect ratio (see 008).

## 006 Editing overlay in DOM/SVG, not WebGL
*2026-10-15 · Accepted*

**Context.** Handles need to be crisp, easy to hit, accessible, and
styled in the surface's color.

**Decision.**
- The outline is SVG, in a `0 0 1 1` viewBox stretched over the canvas.
- Handles are absolutely positioned `div`s using percentage coordinates.
- The WebGL canvas sits underneath with `pointer-events: none`.

**Alternatives.** Drawing handles in Three.js. That needs manual hit
testing, gives 1px WebGL lines, and has no focus or keyboard support.

**Consequences.** CSS hover, focus and transitions for free, and hit
areas larger than the visuals (36px corners, 28px nodes). Layering has to
be explicit: canvas 0, outline 1, handles 2, and the engine *prepends* its
canvas.

## 007 Edge nodes via a Coons patch over the four edges
*2026-10-15 · Accepted*

**Context.** Real surfaces aren't always rectangles: arches, angled cuts,
notches.

**Decision.** Keep the four corner pins, and allow extra nodes on each
edge. Warp with a Coons patch over the four edge polylines. Each node
stores a fixed content parameter `t` and a draggable frame position.

**Alternatives.**
- **Quad warp plus a polygon mask.** Simple, but it only clips content and
  never bends it to the shape.
- **A free N-gon, triangulated.** Fully flexible, but texture mapping a
  triangulated polygon with no interior points distorts badly, and the
  "corners" lose meaning.
- **Mean-value or generalized barycentric coordinates.** Smooth, but
  heavier math, and no exact reduction to the existing quad warp.

**Consequences.**
- With no nodes it reduces *exactly* to the old bilinear warp, so nothing
  regressed.
- Content bends to the shape, and adding a node never changes the shape.
- The data model change was small (`edgeNodes`, alongside `corners`).
- Limits: edges are piecewise-linear, folding isn't prevented, and
  there's a cap of 24 nodes. The mesh went from 32×32 to 48×48 to resolve
  nodes.

## 008 Editor stage locked to the projector's aspect ratio
*2026-10-15 · Accepted*

**Context.** With normalized coordinates (005), a stage that's wider or
taller than the projector distorts every shape in the editor.

**Decision.** The stage letterboxes to the live display's aspect ratio,
falling back to the picked display, then 16:9. A label reads
`PROJECTOR · W×H · ratio`. Implemented with CSS container-query units.

**Consequences.** A square in the editor is a square on the wall. The
display list moved from `Sidebar` up to `App`.

## 009 Visibility applies to the projector too
*2026-10-15 · Accepted*

**Decision.** The sidebar dot hides a surface in both the editor and the
output, like a layer toggle in design tools.

**Alternatives.** An editor-only hide, which is a quick split if users
want it.

**Consequences.** Useful for calibrating one surface at a time on the
wall. The risk is hiding something by accident during a live show.

## 010 Outline is editor-only; opacity is projected
*2026-10-15 · Accepted*

**Decision.** `outlineColor` drives the editor's outline, handles, fill
tint and sidebar accent, and is never drawn on the projector. `opacity`
affects the projected content.

**Open.** A "show outline on projector" toggle would help on-wall
calibration. It isn't built yet.

## 011 Automatic surface colors from a curated palette
*2026-10-15 · Accepted*

**Decision.** There are eight softened primaries, ordered for contrast
between neighbours. A new surface takes the first unused color, then the
list cycles.

**Consequences.** Every surface is distinguishable at a glance with no
setup. The palette is one list in `src/shared/types.ts`.

## 012 AI generation behind a provider interface, mocked for now
*2026-09-01 · Accepted (provider choice open)*

**Decision.** A `ContentProvider` interface, with a local
`MockPatternProvider` so the generate → texture → warp pipeline works
without a network or an API key.

**Open — the biggest product decision.** Whether output is a still image
or video/animation decides the whole content pipeline, the cost model,
and whether textures are images or video elements. API keys must live in
the main process via `safeStorage` (OS keychain), never in renderer
storage.

## 013 Security hardening deferred to pre-ship
*2026-09-01 · Superseded by [020](#020-phase-1-hardening-sandbox-csp-ipc-trust-fuses)*

**Decision.** `sandbox: false` and no CSP during development, to avoid
friction with the ESM preload and dev hot reload.
`contextIsolation: true` and `nodeIntegration: false` stay on.

**Must change before** any packaged release (see roadmap).

## 014 One shared media library, content-addressed, owned by main
*2026-10-15 · Accepted*

**Decision.** Every image (uploaded or generated) lives in one app-wide
library under `userData/media`, keyed by the SHA-256 of its bytes.
Surfaces reference images by `assetId`. Deleting a surface never deletes
its image. Only the main process touches the files.

**Why.** Swapping content between surfaces is the core workflow, and a
shared library makes "put that image back" free. Hash ids give free
dedupe and immutable caching. Per-project bundling can come later as an
export step, not a storage model.

**Consequences.** Replaces `GeneratedContent`/`SceneState.content`
(base64 in the scene). See [media-library.md](media-library.md).

## 015 Serve media over a custom protocol, not IPC or data URLs
*2026-10-15 · Accepted*

**Decision.** `mirrorcat-media://asset/<id>` and `…/thumb/<id>`, served by
`protocol.handle` from a privileged, CORS-enabled, streamable scheme.

**Why.** Both windows load images directly, so the scene synced every
drag frame drops from megabytes to kilobytes. It also works with the
planned CSP and `sandbox: true`, and with video streaming later.
`file://` URLs would expose real paths and break under a CSP.

## 016 Autosave the scene to userData; images only for v1
*2026-10-15 · Accepted*

**Decision.** Main debounces the existing `scene:update` stream into
`userData/scene.json`, restored before the control window's first
render. Uploads are images only (PNG/JPEG/WebP/GIF); video is deferred.
The library opens as a toggleable panel on the right of the stage, not a
separate tab, so you can assign images while seeing the surfaces.

**Supersedes** the "save/load project file" first step in the roadmap.
Explicit save-as/open of named projects is still possible later, built on
the same normalized format.

## 017 Video: probe in the renderer, stream in main, muted playback
*2026-10-16 · Accepted*

**Decision.** MP4, MOV and WebM are accepted.

- Main sniffs the container, then streams the file into the library
  (hash while copying), so even multi-GB files never sit in memory.
- The control window probes each new video: size, duration,
  playability and poster frame. Main has no video decoder, and the
  renderer is the thing that will actually play the file.
- The media protocol supports Range requests.
- Playback is per surface: **Loop** or **Once** (hold the last frame),
  plus a **Restart**. Restart is a counter in the synced scene, so the
  projector restarts in step.
- Videos are always muted.
- Every preview carries a file-type badge.

**Why.** Container ≠ codec: a MOV can be H.264 (plays) or ProRes
(doesn't). Only trying to decode it in Chromium answers that honestly,
so unplayable files are imported but flagged, rather than rejected on a
guess. The same probe also makes WebP/GIF thumbnails, closing that gap.

**Consequences.**
- The output window now follows the media library list, so it knows an
  asset's kind.
- `Surface` gains `loop` and `playToken`.
- See [media-library.md](media-library.md#video-playback).

## 018 Layers panel ordering; Shift-drag locks to the media's proportions
*2026-10-16 · Accepted (edge-point behavior provisional)*

**Decision.**
- **Order.** The surfaces array is the stacking order (back to front),
  and the sidebar shows it reversed (top row = front), like design-tool
  layer panels. Restack by dragging rows or with Alt+↑/↓. The editor now
  draws content in true order, plus a content-free handles layer for the
  selected surface.
- **Shift-drag.** Shift-dragging a corner snaps the surface to an upright
  rectangle in the **media's** aspect ratio (not a forced square), with
  the opposite corner anchored, so the media scales instead of warping.
  Edge points scale with the shape for now.

**Why.**
- Devin asked for hierarchy you can see on the projector, and for
  Shift-resize that "resizes the media inside it instead of warping it".
  Matching the media's proportions is the only shape that achieves that
  without cropping. A square would crop any non-square media.
- Lifting the selected surface to the top in the editor would contradict
  the projector once order is meaningful, hence the separate handles layer.

**Revisit.** Scale vs. clear edge points on Shift-drag, after Devin has
used it on real surfaces.

## 019 Undo/redo for surface shape, via a custom Edit menu
*2026-10-16 · Accepted*

**Context.** Calibration is fiddly; one stray drag could wreck a careful
alignment with no way back. Electron's default Edit ▸ Undo only affects
text fields.

**Decision.**
- Snapshot-based history of each surface's `corners` and `edgeNodes`,
  kept in a module outside the scene store.
- One step per gesture: a drag, an insert, a delete, or a stepper click.
- A custom Edit menu forwards Undo/Redo (⌘Z / ⇧⌘Z) to the control window,
  which falls back to native text undo when a text field has focus.

**Alternatives.**
- **Command/patch-based history.** Smaller entries, but every edit type
  needs an inverse. Snapshots are tiny here, since corner and node arrays
  are already replaced immutably.
- **Undo inside the zustand store.** It would fire store subscriptions and
  trigger projector sync on history-only changes.
- **Catching ⌘Z with a renderer `keydown` listener.** It would fight the
  menu's accelerator, and wouldn't work while the projector window has
  focus.

**Consequences.** Scope is shape only for now. Color, opacity, visibility,
media, rename, reorder and surface deletion aren't undoable yet. Extending
history to whole-surface snapshots is the natural next step, and the
module's API wouldn't need to change.

## 020 Phase 1 hardening: sandbox, CSP, IPC trust, fuses
*2026-10-21 · Accepted*

**Decision.** Both windows run with `sandbox: true` (preload built as
`.cjs`). Packaged builds get a strict CSP injected at build time (dev
keeps HMR). Only the control window may call mutating IPC; scenes are
validated on the way in. Dropped-file paths are resolved in the preload.
Windows are locked to the app page, external links must be `https:`.
Electron fuses are flipped by electron-builder.

**Why now.** Cheap to do before the AI provider lands; much harder once
network calls and API keys are in the mix.

**Verified by** `e2e/smoke.spec.ts` (sandbox, CSP, media under CSP, no
console errors) and `@electron/fuses read` on a `--dir` package.

## 021 Tests: Vitest for logic, Playwright for the built app
*2026-10-21 · Accepted*

**Decision.** Vitest 4 unit tests live next to the code
(`src/**/*.test.ts`) and cover pure geometry, the byte sniffers (with a
fuzz test), the media library and autosave against temp folders, scene
validation, and renderer state (undo). React components and the WebGL
engine are covered by one Playwright smoke test of the built app rather
than unit tests. CI runs typecheck, lint, coverage and build on every
push.

**Why Vitest 4, not 5.** npm 10's resolver crashes on Vitest 5's optional
peer set; Vitest 4 supports Vite 7 and everything used here. Revisit
with the Vite 8 upgrade.

## 022 Perspective warp and alignment grid
*2026-10-27 · Accepted*

**Decision.** Surfaces get `warp: 'perspective' | 'bilinear'` and
`showGrid`. Perspective (a homography of the corners, with edge-node
offsets blended on top) is the default for new surfaces; scenes saved
before this load as bilinear so existing calibration doesn't shift. The
grid is a per-surface toggle drawn in UV space by a shader, and it is
projected as well as shown in the editor.

**Why.** Devin wanted to see how content behaves on surfaces at an angle.
A grid on the bilinear warp would bend with the corners but stay evenly
spaced, which hides the problem: real flat surfaces foreshorten. So the
grid alone would have been misleading; it ships with the warp that makes
angled surfaces look right.

**Considered.** Perspective only when a surface has no edge nodes
(rejected: adding the first node would make the whole surface jump).
An editor-only grid (rejected: projecting it is the useful part).

**Verified by** `surfaceGeometry.test.ts` (corners exact, diagonals cross
at the true center, straight lines stay straight, parallelogram = bilinear,
non-convex fallback, adding a node moves nothing) and `e2e/grid.spec.ts`
(shader compiles in the built app, drawer toggles, fallback note).
