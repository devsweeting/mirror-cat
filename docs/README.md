# MirrorCat documentation

MirrorCat is a desktop app for home projection mapping. You describe what
you want, it generates a visual, you shape that visual to fit a real
object (a wall, a box, a doorway) by dragging corner pins and edge nodes,
and a second fullscreen window sends the result to your projector.

These docs describe how the app is built today and why. They are written
against the code as of **October 2026** (v0.1.0, pre-release).

| Doc | Read it when you want to… |
| --- | --- |
| [Architecture](architecture.md) | Understand the big picture: processes, windows, data flow, the IPC contract. |
| [Components](components.md) | Find which file does what, and how the pieces talk to each other. |
| [Surfaces & warping](surfaces-and-warping.md) | Work on the core feature: the surface model, corner pins, edge nodes, the warp math, and the editor overlay. |
| [Media library & autosave](media-library.md) | Work on uploads, the library panel, surface content, or what gets saved to disk. |
| [Decisions](decisions.md) | Know *why* something is the way it is before changing it. |
| [Roadmap & risks](roadmap-and-risks.md) | See known gaps, open product questions, and what's likely to break first. |

## Conventions for keeping these docs useful

- **Docs follow code.** If you change behavior described here, update the
  doc in the same commit. A stale doc is worse than no doc.
- **Decisions are append-only.** Don't rewrite an old entry in
  `decisions.md` when you change your mind. Add a new entry that
  supersedes it, so the history of *why* survives.
- **Link to files, not line numbers.** Line numbers rot on the next edit.
- `CLAUDE.md` at the repo root is a condensed version for AI coding
  sessions. Keep the two consistent; these docs are the long form.
