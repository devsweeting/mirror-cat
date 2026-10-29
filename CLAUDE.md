# MirrorCat

## What this is

An Electron desktop app that AI-generates projection mapping content for
home use: you describe what you want on a wall/object, MirrorCat generates
visual content, and you warp it (corner-pin) to fit the real surface, then
send it fullscreen to whatever display drives your projector.

## Product role

You are an expert Product Engineer working on this codebase. When asked
to add or change a feature:

1. Clarify missing product requirements or technical unknowns before
   writing code.
2. Propose a simple, high-impact approach (this is a home-use hobbyist
   app, not an enterprise product -- bias toward simple).
3. Note the technical trade-offs / architecture decisions involved.
4. Write clean, production-ready TypeScript.
5. Call out edge cases or scaling risks introduced by the change.

## Architecture

Long-form docs live in `docs/` (architecture, components, surfaces & warping,
decisions log, roadmap). Keep them in sync with code changes.

Standard Electron three-process split, scaffolded with `electron-vite` +
TypeScript + React + Three.js:

- `src/main/` -- Electron main process. Owns two kinds of windows:
  - **control window** (`windows/controlWindow.ts`): normal window on
    your laptop screen, where you edit surfaces, drag corner-pin handles,
    and type AI prompts.
  - **output window** (`windows/outputWindow.ts`): borderless, fullscreen
    window opened on whichever display you pick (`displays.ts` lists
    displays via `screen.getAllDisplays()`), positioned at that display's
    bounds. This is the window that actually faces the projector.
  - `ipc/handlers.ts` wires both together: the control window pushes
    scene updates over IPC, main relays them to the output window if one
    is open, and also caches the latest scene so a newly (re)opened
    output window isn't blank. Each update is also autosaved (debounced)
    to `userData/scene.json` by `persistence/sceneAutosave.ts`.
  - `media/`: the app-wide **media library** (images + MP4/MOV/WebM
    video). Files are stored content-addressed in `userData/media`, with
    videos streamed in. They're served to both windows on the
    range-capable `mirrorcat-media://asset|thumb/<id>` protocol. The
    control window probes videos (size, duration, playability, poster
    frame) and reports back via `media:attach-probe`. Surfaces hold only
    `assetId` (+ `fit`, `loop`, `playToken`); media never travels over
    scene IPC. Long form: `docs/media-library.md`.

- `src/preload/index.ts` -- the only bridge between renderer and Node.
  `contextIsolation: true`, `nodeIntegration: false`. Exposes a narrow
  `window.mirrorcat` API (get displays, open/close output window, send/
  receive scene updates). Renderer code should never need anything Node
  can't be reached from here.

- `src/renderer/` -- one Vite app, two entry points via a hash route:
  `App.tsx` (control UI, default) and `OutputApp.tsx` (loaded as
  `index.html#/output`, no editing chrome). They share
  `components/ProjectionCanvas.tsx`.

  - `engine/ProjectionEngine.ts` -- owns the Three.js renderer for one
    surface: a 48×48 subdivided mesh rendered with an orthographic camera
    sized to the container in pixels.
  - `shared/surfaceGeometry.ts` -- the projection-mapping math (no Three.js
    dependency). A surface is 4 corner pins plus optional **edge nodes** on
    each edge (`Surface.edgeNodes`, edge i runs corner i → corner i+1).
    The mesh is a Coons patch over the four edge polylines; with no nodes
    it is exactly the classic bilinear quad warp. Each node stores a fixed
    content parameter `t` along its edge plus a draggable frame position.
    `Surface.warp` picks `perspective` (homography of the corners as the
    base, edge-node offsets blended on top; new surfaces) or `bilinear`
    (older saves). Perspective falls back to bilinear while the corners
    aren't convex. `Surface.showGrid` draws a UV-space alignment grid
    (shader in `ProjectionEngine.ts`) on the editor *and* the projector.
  - Surface masks (`shared/mask.ts`, `shared/warpPick.ts`,
    `main/masks/maskStore.ts`, `state/maskPaint.ts`,
    `hooks/useSurfaceMask.ts`; docs/surfaces-and-warping.md → "Masks",
    decision 024): `Surface.mask` is a grayscale PNG in the surface's UV
    space in `userData/masks`, served as `mirrorcat-media://mask/<id>`,
    turned into a signed distance field in the renderer so grow/feather/
    invert are uniforms. Edited in "mask mode" (M, ⇧⌘M, or the drawer's
    mask well): the mask bar replaces the prompt bar; Outline (polygon,
    default) and Brush tools, mapped through the drawn mesh
    (`pickWarpGrid`, `outlineToContent`); hidden areas preview hatched in
    the editor only. Images become masks via drop / native dialog / the
    surface image's alpha. Unused masks are swept on launch (decisions
    024–025).
  - Scan / phone capture (`main/capture/`, `main/ipc/captureHandlers.ts`,
    `components/ScanDialog.tsx`; docs/phone-capture.md, decision 028): a
    QR code for a short-lived, token-gated page on the home network
    (one LAN address, random port, open only while the dialog is). The
    phone uploads a ≤4096 px JPEG into the library. Dev override:
    MIRRORCAT_CAPTURE_HOST=127.0.0.1. When live, the projector shows a
    scan pattern (glowing frame + ArUco markers, `shared/scanPattern.ts`);
    main finds the frame (`main/capture/frameDetect.ts`, js-aruco2 --
    CommonJS, import its default), the dialog lets you check corners,
    and "Project onto the wall" straightens the frame's part of the photo
    (`capture:rectify`, `main/capture/rectify.ts`) onto a surface that
    fills the frame exactly (decisions 029–030). Surfaces never reach past
    the frame in new flows; old ones get "Fit to the frame" in the drawer.
    The projector window reports its real display (`output:display-changed`).
  - Settings › AI & animation (`components/settings/`, `main/ai/`,
    `shared/ai.ts`; docs/ai-settings.md): provider keys checked with a free
    request, encrypted with safeStorage in main, never returned to the
    renderer (statuses only). Dev hooks: MIRRORCAT_AI_FAKE_CRYPTO=1,
    MIRRORCAT_AI_KEYCHECK=accept|reject|offline.
  - `ai/contentService.ts` -- `ContentProvider` interface + a
    `MockPatternProvider` placeholder (procedural canvas gradient, no
    network call). Swap in a real generative backend by implementing
    `ContentProvider` and calling `setContentProvider(...)`. No provider
    has been chosen yet -- see README "Wiring a real AI provider".
  - `state/sceneStore.ts` -- zustand store, single source of truth in the
    control window. `App.tsx` subscribes and forwards every change to
    main via `window.mirrorcat.sendSceneUpdate`; the output window has no
    store of its own and just renders whatever it's sent.

- `src/shared/` -- types (`types.ts`) and IPC channel names
  (`ipcChannels.ts`) imported by both main and renderer, so the two sides
  can't drift out of sync on the wire format.

## Commands

- `npm install` -- first-time setup (also downloads Electron's binary,
  which needs a normal internet connection).
- `npm run dev` -- electron-vite dev server with HMR. Only the renderer
  hot-reloads: after changing `src/main/`, `src/preload/` or `src/shared/`
  code used by main, **restart `npm run dev`** (a stale preload/main means
  new IPC is missing and new scene fields get dropped by the old
  validator). Check `ps` for leftover dev sessions -- two running at once
  share and fight over the same `scene.json`.
- `npm run build` -- production bundle to `out/`.
- `npm run typecheck` -- `tsc --noEmit` for both the node (main/preload)
  and web (renderer) TS projects.
- `npm run lint` -- ESLint (flat config, `eslint.config.js`); warnings fail.
- `npm test` / `npm run test:watch` / `npm run test:coverage` -- Vitest
  unit tests (`src/**/*.test.ts`, config in `vitest.config.ts`).
- `npm run test:e2e` -- builds, then drives the built app with Playwright
  (`e2e/`), using a throwaway `MIRRORCAT_USER_DATA` folder.
- `npm run check` -- typecheck + lint + unit tests; run before committing.
- `npm run verify` -- everything (check + coverage + build + e2e) with a
  summary; `-- --quick` skips build/e2e, `-- --package` also packages
  and checks Electron fuses. Run before opening a PR.
- `MIRRORCAT_OUTPUT_WINDOWED=1 npm run dev` -- projector view opens as a
  small window instead of fullscreen (dev builds only).
- `npm run build:mac` / `build:win` / `build:linux` -- packaged installer
  via electron-builder (config in `electron-builder.yml`).

## Known gaps (see README "Roadmap & known risks" for detail)

Persistence is autosave only (no named projects/export yet), videos are
always muted and not frame-locked between editor and projector, no real
AI provider wired in yet, single output window (one projector), one
WebGL context per surface. Set `MIRRORCAT_USER_DATA=/some/tmp/dir` to run
against a scratch library and autosave instead of your real data.
