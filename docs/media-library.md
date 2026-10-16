# Media library & autosave

How images and videos get onto surfaces, where they live on disk, and how
the scene survives a restart.

## What the user sees

- **Library button** in the top bar toggles a panel on the **right** of
  the stage. Whether it's open is remembered per machine.
- The panel lists every image and video (newest first) with a filter for
  All / Uploads / Generated. **Add images or videos** opens the OS picker;
  files can also be dropped anywhere on the panel.
- Every preview has a **file-type badge** in its bottom-right corner
  (PNG, JPG, WEBP, GIF, MP4, MOV, WEBM). Videos get a small play glyph
  in the badge, and a video that can't be decoded here has a red badge.
- Click a tile to inspect it: rename it, see its type, size, length and
  prompt, and which surfaces use it. **Double-click** or **Use on
  _Surface_** puts it on the selected surface. The tile already on that
  surface wears the surface's color. How-to text sits behind an info icon.
- **Delete** asks first. If surfaces use the file, they go blank.
- Each surface's settings drawer starts with a **preview row**:
  thumbnail, name, and size (plus length for videos). Clicking it opens a
  small menu:
  - **Upload image or video…** picks a file and puts it straight on
    this surface.
  - **Choose from library** selects this surface and opens the panel.
  - **Remove from surface** clears it; the file stays in the library.

  The menu closes on Escape or an outside click, and arrow keys move
  through it. Below the row:
  - **Fit** (Stretch / Fill) appears once there's media.
  - **Playback** (Loop / Once, plus a restart button) appears for videos.
- **Drop files on the stage** to import them and put the first one on
  the selected surface.
- Generated images go into the library too, so swapping away from one
  never loses it.

## Video playback

- Videos play **muted**. Autoplay requires it, and a projection rig
  shouldn't start making noise unannounced.
- **Loop** repeats forever. **Once** plays to the end and holds the last
  frame. Switching back to Loop after a one-shot ended starts it again.
- **Restart** bumps `Surface.playToken`, which is part of the synced
  scene, so the projector restarts at the same moment as the editor
  preview.
- The editor and the output window each run their own `<video>`; the
  projector's is the one that matters. They start together but aren't
  frame-locked.
- Each video surface uses a detached `<video>` feeding a
  `THREE.VideoTexture`. The element is paused and its source released
  whenever the surface's media changes or the surface unmounts, so
  decoders don't pile up.

## Storage layout

Everything is under Electron's `userData` folder
(`~/Library/Application Support/mirrorcat` on macOS; override with the
`MIRRORCAT_USER_DATA` environment variable for tests):

```
scene.json            surfaces (autosave)
media/library.json    asset index
media/files/<sha256>.<ext>
media/thumbs/<sha256>.jpg   thumbnails and video poster frames
```

Asset ids are the SHA-256 of the file bytes, so importing the same file
twice reuses the existing asset. Both JSON files are written atomically
(temp file + rename). If either is unreadable on launch, it is moved
aside as `*.corrupt-<timestamp>` and the app starts fresh rather than
crashing or overwriting it. Index entries from before video support have
no `kind` and load as images.

## How bytes reach the GPU

The main process serves files on a custom protocol, registered as a
privileged scheme (standard, secure, CORS-enabled, streaming) before
app ready:

- `mirrorcat-media://asset/<id>`: the original file
- `mirrorcat-media://thumb/<id>`: the thumbnail or poster frame. For an
  image without one it serves the original; for a video without one, 404.

Files are streamed, never read whole, and **HTTP Range requests** are
supported (`206 Partial Content`). `<video>` needs this to seek, to loop,
and to read an MP4's index without downloading everything first. Only
ids in the index resolve, so a crafted URL can't read arbitrary paths.
Responses carry `Access-Control-Allow-Origin: *`, because textures and
videos load with `crossOrigin="anonymous"` and WebGL rejects non-CORS
pixels.

Because surfaces carry only `assetId`, the scene sent over IPC on every
drag frame is a few KB. The output window follows the library list too
(`connectMediaLibrary({ probe: false })`), so it knows which assets are
videos.

## Import pipeline (main process)

`src/main/media/mediaLibrary.ts`, `imageInfo.ts`:

1. `stat` the file, then **sniff its first 256 bytes**, never the
   extension:
   - Images: PNG, JPEG, WebP, GIF.
   - Videos: an MP4/M4V `ftyp` box, QuickTime (`ftyp qt` or a bare
     `moov`/`mdat` atom), or WebM.
   - Rejected with a specific message: HEIC/AVIF, MKV, audio-only
     M4A/M4B, and anything else.
2. Size check by kind: 50 MB per image, 2 GB per video.
3. **Images** are read into memory, measured from the header, hashed,
   written, and thumbnailed with `nativeImage` (PNG/JPEG).
4. **Videos** are streamed: hashed while being copied to a temp file in
   `files/`, then renamed to `<sha256>.<ext>`. They're stored with size 0
   and `probed: false`, because main can't decode video.
5. Update the index and broadcast `media:changed` to every window.

Batches are imported one file at a time, capped at 100 per drop, and
each failure is reported per file without stopping the rest.

## Probing (control window)

`src/renderer/src/state/mediaProbe.ts` finds assets with
`needsProbe(asset)`:

- every video not yet probed;
- images `nativeImage` couldn't thumbnail (WebP, GIF).

It handles them one at a time in the control window only:

- **Video:** load the metadata, seek about 10% in (frame 0 is often
  black), read `videoWidth`/`videoHeight`/`duration`, and draw a ≤320px
  JPEG poster frame. Any decode error, a 20 s timeout, or an audio-only
  track marks it `playable: false` (e.g. a ProRes MOV).
- **Image:** decode, read the real size (after EXIF rotation), and draw
  a thumbnail.

The result goes back over `media:attach-probe`. Main validates it (a
JPEG under 2 MB, sane numbers), writes the thumbnail, sets
`probed: true`, and re-broadcasts the library. An unplayable video is
never handed to a surface: `surfaceMedia()` returns nothing for it, so
the surface shows its placeholder, and the drawer and library explain
why.

## Rendering

- `ProjectionCanvas` takes `media: { url, kind }`.
  - **Images** load with `TextureLoader`. One larger than the GPU's
    `maxTextureSize` is redrawn onto a canvas that fits, because an
    oversized texture renders blank.
  - **Videos** become a `VideoTexture` once the first frame is ready
    (`loadeddata`).
- If the file is missing, the surface falls back to the placeholder fill
  and the drawer shows **Missing file**.
- **Fit: Fill** crops with UV `repeat`/`offset`, so the media keeps its
  proportions. It uses `videoWidth`/`videoHeight` for videos. The
  surface's aspect is estimated from its corner-to-corner edge lengths in
  pixels, and is recomputed as corners move.

## Autosave

`src/main/persistence/sceneAutosave.ts` piggybacks on the existing
`scene:update` stream: main debounces it (400 ms) and writes
`scene.json`. Pending writes are flushed on quit. Only surfaces are
saved, including `fit` and `loop`. Two things are deliberately not
restored:

- which display is projecting, because it's live hardware state;
- `playToken`, which resets to 0.

On launch, `main.tsx` asks for the saved surfaces **before the first
render**, so the default scene never flashes, never syncs to the
projector, and never gets autosaved over the real one. Loading normalizes
each surface: missing newer fields get defaults (`loop: true`), and
broken entries are dropped. `App` sends the starting scene once on mount,
so a projector opened before any edit isn't blank.

## Edge cases handled

| Case | Behavior |
| --- | --- |
| Same file imported twice | Deduplicated by hash (videos: copied, hashed, temp copy discarded) |
| HEIC / AVIF / MKV / audio / unknown | Rejected with a reason, rest of batch continues |
| Image >50 MB / video >2 GB | Rejected before reading |
| Video container OK but codec unsupported (ProRes, some HEVC) | Imported, probed as unplayable, red badge + explanation, never put on the projector |
| Image larger than GPU texture limit | Downscaled on load |
| Asset deleted while on surfaces | Confirm, then surfaces cleared first |
| File missing from disk | Placeholder + "Missing file" |
| Surface deleted | Its media stays in the library |
| Drop outside a drop zone | Ignored (Electron would otherwise navigate to the file) |
| Corrupt `library.json` / `scene.json` | Moved aside, app starts fresh |
| Quit right after an edit | Pending save flushed in `before-quit` |

Verified end to end with Playwright driving the built app against a
scratch `MIRRORCAT_USER_DATA`:

- H.264 MP4 and MOV, and VP9 WebM, imported with correct size, length
  and poster frame.
- A ProRes MOV was flagged unplayable.
- MKV and M4A were rejected.
- Range requests returned 206 with the right `Content-Range`.
- A video played on a surface, and Loop → Once reached the autosave.

## Follow-ups

- **Audio.** Videos are always muted. A per-surface "Sound" toggle would
  need `autoplayPolicy: 'no-user-gesture-required'` on the output window,
  and a decision about which window plays the audio.
- **Frame-locked playback** between editor and projector. Today they
  start together but can drift; the editor preview could pause while
  live.
- **Videos larger than the GPU texture limit** (e.g. 8K) aren't
  downscaled.
- **Library filter by kind** (Images / Videos).
- **Orphan cleanup.** Delete files not in the index and stray
  `files/.import-*.tmp` files on launch, left by a crash mid-import or
  mid-delete.
- **Library disk usage.** Show the total size; no cap today.
- **Project export.** Bundle a scene plus the assets it references, for
  moving setups between machines.
- **CSP:** when added, it needs `img-src 'self' mirrorcat-media:` and
  `media-src 'self' mirrorcat-media:`, with `connect-src` to match.
