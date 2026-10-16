# Components

A file-by-file map of the codebase: what each piece owns and who it talks
to. For the warp engine and surface editing in depth, see
[Surfaces & warping](surfaces-and-warping.md).

```
src/
├── main/                    Node / Electron main process
│   ├── index.ts
│   ├── displays.ts
│   ├── fsUtil.ts            Atomic writes, corrupt-file quarantine
│   ├── ipc/handlers.ts
│   ├── media/               Media library (see media-library.md)
│   │   ├── mediaLibrary.ts
│   │   ├── imageInfo.ts
│   │   └── protocol.ts
│   ├── persistence/sceneAutosave.ts
│   └── windows/
│       ├── controlWindow.ts
│       └── outputWindow.ts
├── preload/                 The only bridge between main and renderers
│   ├── index.ts
│   └── index.d.ts
├── shared/                  Imported by main AND renderer; no DOM, no Electron
│   ├── types.ts
│   ├── ipcChannels.ts
│   ├── media.ts             MediaAsset type, media URLs, import limits
│   └── surfaceGeometry.ts
└── renderer/
    ├── index.html
    └── src/
        ├── main.tsx         Routes to App or OutputApp
        ├── App.tsx          Control window
        ├── OutputApp.tsx    Output window
        ├── state/
        │   ├── sceneStore.ts
        │   ├── mediaStore.ts    Library list + import helpers
        │   └── uiStore.ts       Library panel open/closed
        ├── hooks/useFileDrop.ts
        ├── engine/ProjectionEngine.ts
        ├── ai/contentService.ts
        ├── components/
        │   ├── ProjectorControl.tsx
        │   ├── Sidebar.tsx
        │   ├── SurfaceSettingsDrawer.tsx
        │   ├── SurfaceContentControls.tsx
        │   ├── LibraryPanel.tsx
        │   ├── ProjectionCanvas.tsx
        │   ├── PromptPanel.tsx
        │   └── CatEyes.tsx
        └── styles/
            ├── global.css       Imports the files below, in order
            ├── tokens.css       Palette, type, shared controls
            ├── shell.css        App shell, top bar, projector control
            ├── sidebar.css      Surface list + settings drawer
            ├── stage.css        Stage, projector frame, canvas overlay
            ├── composer.css     Cat's eyes + prompt bar
            └── library.css      Library panel
```

---

## Main process — `src/main/`

### `index.ts`
App lifecycle. On ready it creates the control window and registers IPC
handlers. Closing all windows also closes the output window. On macOS the
app stays alive and re-opens the control window on dock click.

### `appMenu.ts`
The menu bar. It uses Electron's stock roles, except Edit ▸ Undo / Redo,
which forward an `edit:command` to the control window (see
[Surfaces & warping → Undo / redo](surfaces-and-warping.md#undo--redo)).

### `windows/controlWindow.ts`
Creates the 1280×800 editor window (minimum 960×640). On macOS the title
bar is hidden (`hiddenInset`) and the app's top bar doubles as it, with
the traffic lights inset. In dev it loads the
Vite dev server URL; packaged, it loads the built `index.html`. External
links are handed to the OS browser instead of navigating the app.

### `windows/outputWindow.ts`
Creates the projector window: frameless, fullscreen, not resizable or
movable, hidden from the taskbar, black background, positioned on the
chosen display's bounds. It loads the same renderer with the `#/output`
hash. Only one output window exists at a time; opening a new one closes
the old one. A guard ensures a late `closed` event from an old window
can't clear the reference to its replacement.

### `displays.ts`
Turns Electron's `screen.getAllDisplays()` into the app's `DisplayInfo`
shape (id, label, bounds, isPrimary). The label is the OS display name
(e.g. `Built-in Retina Display`), falling back to `Main display` /
`External display N`; resolution is shown separately by the UI.

### `ipc/handlers.ts`
Implements every channel in [the IPC contract](architecture.md#ipc-contract).
Holds `latestScene`, the last scene the control window sent, and replays
it to the output window when it finishes loading (the cache survives
closing output). Every scene update is also handed to `SceneAutosave`.
The `media:*` channels front `MediaLibrary`, and library changes are
broadcast to all windows.

### `media/` and `persistence/`
The media library (content-addressed files + index), byte sniffing for
imports, the `mirrorcat-media://` protocol, and the debounced
`scene.json` autosave. Covered in [media-library.md](media-library.md).

---

## Preload — `src/preload/`

### `index.ts`
Exposes `window.mirrorcat` through `contextBridge`, a small typed API
(`getDisplays`, `openOutputWindow`, `closeOutputWindow`,
`sendSceneUpdate`, `onSceneUpdate`, `requestSceneSync`, `loadSavedScene`,
`getPathForFile`, and a `media` namespace for the library).
Subscriptions return an unsubscribe function so React effects can clean up.

Built as ESM (`index.mjs`) because `package.json` sets `"type": "module"`.

### `index.d.ts`
The `MirrorCatApi` type and the global `Window` augmentation, so renderer
code gets type-checked calls.

---

## Shared — `src/shared/`

No DOM, no Electron, no Three.js. Anything here must run in both
processes and in plain Node (which is also what makes it unit-testable).

### `types.ts`
The data model:
- `Corner`, `CornerSet` (4 corners: TL, TR, BR, BL)
- `EdgeNode`, `EdgeNodeSet` (extra points per edge)
- `Surface` (with `assetId` and `fit`), `SurfaceSettings`, `SceneState`, `DisplayInfo`
- `DEFAULT_CORNERS`: new surfaces start inset 15% from the frame edge
- `SURFACE_PALETTE` and `nextSurfaceColor()`: automatic outline colors
- `createSurface()`: the only place surfaces are constructed

### `ipcChannels.ts`
Channel name constants. Never hard-code a channel string anywhere else.

### `surfaceGeometry.ts`
All the projection-mapping math: the outline polygon, edge-node insert,
move and remove helpers, and `writeWarpGrid()` (the Coons-patch warp).
Pure functions over plain data. Covered in depth in
[Surfaces & warping](surfaces-and-warping.md).

---

## Renderer — `src/renderer/src/`

### `main.tsx`
Entry point for both windows. Reads the URL hash and renders `OutputApp`
for `output`, otherwise `App`. Wrapped in `React.StrictMode`.

### `App.tsx` — control window
- Lays out the top bar (wordmark, library toggle, `ProjectorControl`), the
  surface sidebar, the stage, and Cat's prompt bar docked under the stage.
- **Owns the display list** and the picked display. They live here, not in
  the sidebar, because the stage needs the display's shape.
- **Frames the stage as the projector.** It computes the aspect ratio
  from the live display (or the picked one, or 16:9 as a fallback) and
  shows a `1920 × 1080 (16:9)` caption under the frame. While live, the
  frame gets a warm light spill.
- **Stacks every visible surface in its real order** (array order, back to
  front), then draws the selected surface's handles as a `contentless`
  layer on top, so it's always editable. See
  [Stacking order](surfaces-and-warping.md#stacking-order).
- **Mirrors the store to main**, batched once per animation frame.
- Derives the "effective" selected surface during render, falling back to
  the first surface if the selection was deleted.

### `OutputApp.tsx` — output window
Display only. Requests the cached scene on load, then listens for live
updates (a live update beats a late sync reply). Renders each *visible*
surface with `ProjectionCanvas` and no editing overlay.

### `state/sceneStore.ts`
The single zustand store and the source of truth for the scene. State is
exactly `SceneState`; actions are `addSurface`, `updateCorners`,
`updateEdgeNodes`, `setSurfaceAsset`, `clearAssetEverywhere`,
`updateSurfaceSettings`, `renameSurface`, `removeSurface` (the image stays
in the library), `hydrate` (launch only), and `setOutputDisplayId`.
Updates are immutable, replacing the edited surface object, so React and
the IPC mirror both see clean changes.

### `state/shapeHistory.ts`
Undo/redo for surface shape. UI code must change corners and edge nodes
through `editCorners` and `editEdgeNodes`, not the store's raw update
actions; that's what makes an edit undoable. A drag is one step.

### `state/mediaStore.ts`, `state/uiStore.ts`
The library list, mirrored from main via `media:changed`, plus
`pickAndImport()` and `importDroppedFiles()`. The UI store only holds
whether the library panel is open.

### `components/LibraryPanel.tsx`, `components/SurfaceContentControls.tsx`
The right-hand library panel, and the Content block in the surface
drawer (preview → menu, Fit, and Loop/Once/Restart for videos). See
[media-library.md](media-library.md#what-the-user-sees).

### `components/MediaThumb.tsx`
The inside of any media preview box: a thumbnail (or a video glyph while
the poster frame is being made) plus the file-type badge (PNG, MP4…)
bottom-right. Used in the drawer preview and the library tiles.

### `state/mediaProbe.ts`
Control window only. Measures new videos (size, duration, playability,
poster frame) and WebP/GIF images, one at a time, and reports back via
`media.attachProbe`.

### `engine/ProjectionEngine.ts`
One instance per rendered surface, per window. It wraps a Three.js
`WebGLRenderer`, an orthographic camera sized 1:1 to its container in
pixels, and a 48×48 subdivided mesh. It exposes `setShape`, `setTexture`,
`setFit` (stretch, or fill via UV crop), `setOpacity`, `resize` (driven by a `ResizeObserver`), and `dispose`.
Shape changes rewrite the existing vertex buffer in place; nothing is
reallocated during a drag.

### `components/ProjectionCanvas.tsx`
The React wrapper around an engine, and the whole editing overlay. Modes:
- **editable** (the selected surface in the editor): outline, corner
  targets, edge-node diamonds, and double-click-to-add strips.
- **ghost** (other visible surfaces in the editor): dashed, dimmed
  outline with no handles.
- **neither** (the output window): just the warped content.

It owns pointer handling: drag with grab offset and pointer capture,
double-click insert, and Delete to remove the focused node. Details in
[Surfaces & warping](surfaces-and-warping.md#editing-interactions).

### `components/ProjectorControl.tsx`
Top-bar control: a display picker (native `<select>`, restyled closed
state) and Go live / Stop projecting. "Live" is derived from the store's
`outputDisplayId`, set only once the output window has opened. The
editing screen is marked `(this screen)` in the picker.

### `components/Sidebar.tsx`
The surface list, styled as a layer list. One row per surface:
- A visibility dot (filled = shown, ring = hidden).
- A thumbnail of the surface's current image (hatched slot when empty),
  the name, and a right-aligned caret. Clicking selects the surface and
  toggles its drawer.
- The row's accent color is the surface's outline color, via the
  `--surface-color` CSS variable.
- An `Add surface` row below the list (the new surface is selected).

Which drawers are open is local component state and deliberately not in
the store.

### `components/SurfaceSettingsDrawer.tsx`
The per-surface settings hub. Today it holds:
- An actions row: a pencil icon renames the surface inline (Enter or
  clicking away saves, Escape cancels, blank names are ignored), and a
  trash icon deletes it after an inline "Delete / Cancel" confirmation.
- Content (`SurfaceContentControls`): a preview row that opens a menu
  (Upload / Choose from library / Remove), plus Fit (Stretch / Fill) once
  there's an image
- Outline color: the `SURFACE_PALETTE` swatches plus a custom-color
  swatch wrapping the native picker
- Opacity, 0–100% (styled slider filled in the surface color)
- An edge-node stepper, labelled "Edge points" in the UI (+ adds a node on the longest segment, − removes
  the newest), with an info icon that expands usage help

New per-surface settings belong here.

### `components/PromptPanel.tsx`
Cat's prompt bar, docked under the stage: Cat's eyes, a chip naming the
target surface (hidden when the stage is narrow), an auto-growing prompt
field (Enter generates, Shift+Enter adds a line), and Generate. It calls
the active `ContentProvider`, saves
the result into the media library as a `generated` asset, and puts it on
the selected surface.

### `ai/contentService.ts`
The `ContentProvider` interface, plus `MockPatternProvider`, which draws a
deterministic gradient-and-rings image from a hash of the prompt, with a
fake 300 ms delay. `getContentProvider()` and `setContentProvider()` swap
implementations. No real AI provider is wired in yet
([decision 012](decisions.md#012-ai-generation-behind-a-provider-interface-mocked-for-now)).

### `components/CatEyes.tsx`
The brand mark: two cat eyes with slit pupils, split cyan/magenta
(`--eye-cyan`, `--eye-magenta`, used nowhere else), each glowing in its
own color, with the original slow blink. Moods: `idle` (soft glow),
`live` in the top bar while projecting (full, wider glow), `working` in
the prompt bar while generating (pupils widen, glow breathes). It is
intentionally the only ambient motion in the UI.

### `styles/`
`global.css` only imports the area files, `tokens.css` first. Design
direction ("lights down"): the control window is a dim room
(`--room #1d1a23`, panels `--wall #26232e`, text `--plaster #e8e3d9`),
and the only interface accent, `--bulb #ffd27a`, is reserved for light:
Go live, Generate, and the live frame spill. Surface outline
colors are user content, not UI accents. Type is Bricolage Grotesque
(bundled via `@fontsource-variable`, for the wordmark and panel titles)
plus the system UI font for controls; numbers use tabular figures
(`.num`), not a mono font. Sentence case throughout; no all-caps labels.
Keep each area's rules in its own file, and watch rule order where
selectors have equal specificity (later wins, including over
`@container` blocks earlier in the file). Layering inside a
`ProjectionCanvas` is explicit:

| z-index | Layer |
| --- | --- |
| 0 | WebGL canvas (`pointer-events: none`) |
| 1 | SVG outline and double-click strips |
| 2 | corner targets and edge-node diamonds |
