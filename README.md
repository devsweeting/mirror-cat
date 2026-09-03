# MirrorCat

AI-generated projection mapping content for home use. Describe what you
want, MirrorCat generates a visual, you drag its four corners to fit the
real surface it's projected onto, then send it fullscreen to your
projector.

## Quick start

```bash
npm install
npm run dev
```

This opens the control window. Pick the display your projector is
connected to in the sidebar, click **Send to projector** to open the
fullscreen output window there, select a surface, type a prompt and hit
**Generate**, then drag the four corner handles on the canvas until the
warped rectangle matches your wall/object.

## Architecture

See `CLAUDE.md` for the full breakdown of the main/preload/renderer
split, the control-window vs. output-window model, and the corner-pin
warp engine. Short version: one Electron app, two windows (one you edit
in, one that faces the projector), kept in sync over IPC.

## Wiring a real AI provider

`src/renderer/src/ai/contentService.ts` currently ships a
`MockPatternProvider` that turns a prompt into a deterministic gradient
+ ring pattern locally, with no network call -- it exists so the
generate -> texture -> warp pipeline is testable without an API key.

No real generation backend has been picked yet. That's a real product
decision, not just an implementation detail:

- **Still image vs. video/animation.** A static image on a wall reads as
  a poster; most home projection-mapping content people actually want
  (ambient motion, looping animation) needs a video or shader-loop
  output, which is a very different pipeline (and cost/latency profile)
  than an image model.
- **Provider + cost model.** Image models (e.g. an OpenAI/Stability/
  Replicate-style API) are cheap and fast per generation; video models
  are slower and meaningfully more expensive per generation -- matters
  for a "regenerate until it looks right" UX.
- **API key storage.** Whatever you pick, do not store the key in
  localStorage or commit it. Use Electron's `safeStorage` (OS keychain)
  from the main process and pass a handle/token to the renderer, not the
  raw key.

Once you've decided, implement `ContentProvider` (`generate(request)` ->
`GeneratedContent`) and call `setContentProvider(new YourProvider())`.

## Roadmap & known risks

- **No persistence.** Surfaces, generated content, and corner
  calibration all live in memory and vanish on quit. Next step is a
  save/load project file (JSON matching `SceneState`) via `dialog` +
  `fs` in the main process.
- **No AI provider wired in** (see above) -- currently a local mock.
- **Display disconnects aren't handled.** If the projector's display is
  unplugged while `outputWindow` is open, Electron will emit
  `screen.on('display-removed')`, which nothing currently listens for.
  The output window should close (or move back to the primary display)
  when that fires, rather than leaving a dangling window pointed at a
  display that no longer exists.
- **Unthrottled scene sync.** `App.tsx` sends the full `SceneState` over
  IPC on every zustand state change, including every pixel of a
  corner-drag. Fine at MVP scale (a handful of surfaces, one output
  window); if surfaces/content grow, this needs throttling or diffing
  instead of full-state broadcast.
- **Single output window.** The architecture assumes one projector. A
  real multi-projector home setup (e.g. wrapping content around a
  corner) would need multiple concurrent output windows, one per display,
  each potentially showing a different subset of surfaces.
- **No color/gamma calibration.** Projector output looks different from
  a monitor (dimmer, different color response); nothing here compensates
  for that yet.
- **Corner dragging is mouse/touch-only.** No keyboard nudge (arrow
  keys) for fine calibration adjustments, which matters once you're
  standing across the room from the laptop trying to line things up.
- **CSP is intentionally omitted** from `src/renderer/index.html` for
  now (see the TODO comment there) -- add one back before shipping a
  packaged build.
- **`sandbox: false`** on both BrowserWindows (set for bundling
  compatibility with the current preload setup). `contextIsolation` and
  `nodeIntegration: false` are still on, which covers the main risk, but
  revisit `sandbox: true` before shipping.
