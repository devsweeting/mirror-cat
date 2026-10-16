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
- `npm run dev` -- electron-vite dev server with HMR.
- `npm run build` -- production bundle to `out/`.
- `npm run typecheck` -- `tsc --noEmit` for both the node (main/preload)
  and web (renderer) TS projects.
- `npm run lint` -- ESLint (flat config, `eslint.config.js`).
- `npm run build:mac` / `build:win` / `build:linux` -- packaged installer
  via electron-builder (config in `electron-builder.yml`).

## Known gaps (see README "Roadmap & known risks" for detail)

Persistence is autosave only (no named projects/export yet), videos are
always muted and not frame-locked between editor and projector, no real
AI provider wired in yet, no display-disconnect handling, single output
window (one projector). Set `MIRRORCAT_USER_DATA=/some/tmp/dir` to run
against a scratch library and autosave instead of your real data.
