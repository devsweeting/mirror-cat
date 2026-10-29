# Surfaces & warping

A **surface** is one region of a real-world object you project onto: a
wall panel, the face of a box, an arched doorway. It is the core unit of
the app. Everything else (generating content, projecting) exists to put an
image onto surfaces.

## The surface model

Defined in `src/shared/types.ts`:

```ts
interface Surface {
  id: string
  name: string
  corners: CornerSet        // 4 warp pins: TL, TR, BR, BL (normalized 0–1)
  edgeNodes: EdgeNodeSet    // extra points on each of the 4 edges
  contentId: string | null  // which generated image is mapped onto it
  outlineColor: string      // #rrggbb, editor-only
  opacity: number           // 0–1, applies on the projector too
  visible: boolean          // hidden = not drawn in editor OR on projector
  warp: 'perspective' | 'bilinear'
  showGrid: boolean         // alignment grid, editor AND projector
}
```

| Field | Where it shows | Notes |
| --- | --- | --- |
| `corners` | editor and projector | The four primary pins. Always exactly four. |
| `edgeNodes` | editor and projector | Zero or more per edge, up to 24 total. |
| `contentId` | editor and projector | Points into `SceneState.content`. |
| `outlineColor` | **editor only** | Outline, handles, fill tint, sidebar accent. Never projected. |
| `opacity` | editor and projector | Content opacity. |
| `visible` | editor and projector | Toggled by the dot in the sidebar. |
| `warp` | editor and projector | `perspective` for new surfaces; scenes saved before it existed load as `bilinear` so their calibration doesn't shift. |
| `showGrid` | editor and projector | Projected on purpose: lining it up with the real surface is the point. |

New surfaces come from `createSurface()`:
- They start **inset 15%** from the frame edges, so the shape reads
  clearly and all four handles are grabbable.
- They get the next **free palette color** from `nextSurfaceColor()`.

## Corners and edge nodes

```
 corner 0 (TL) ──── edge 0 (top) ────► corner 1 (TR)
      ▲                                     │
      │                                     │
 edge 3 (left)                       edge 1 (right)
      │                                     │
      │                                     ▼
 corner 3 (BL) ◄─── edge 2 (bottom) ─── corner 2 (BR)
```

Edge *i* runs from corner *i* to corner *(i+1) mod 4*, clockwise. Each
edge holds its nodes in an array sorted by `t`.

An `EdgeNode` has two kinds of position, and the distinction matters:

- **`t` (content position, fixed).** Where along its edge this node sits
  *in the image*, from 0 (start corner) to 1 (end corner). A node with
  `t = 0.5` on the top edge always carries the middle of the image's top
  edge. `t` is set once, at insertion.
- **`x, y` (frame position, draggable).** Where that slice of the image
  lands on the wall. Dragging a node changes only this.

Other fields:
- `seq`: insertion order, so the stepper's "−" removes the newest node.
- `id`: unique within the surface.

### Rules enforced in `surfaceGeometry.ts`

- At most `MAX_EDGE_NODES` (24) extra nodes per surface.
- A node can't be inserted within `t` 0.01 of a corner or of another node
  on the same edge. Such inserts are silently refused (the function
  returns the input unchanged).
- Inserting a node on an existing straight segment, by double-click or
  "+", puts it exactly on that line. **Adding a node never changes the
  shape**; it only gives you a new handle.

## The warp: a Coons patch

The engine draws each surface as a 48×48 grid of quads (49×49 vertices).
Texture coordinates are a plain regular grid, so the image maps evenly in
*content* space. The warp decides where each vertex lands in the frame.

`writeWarpGrid()` in `src/shared/surfaceGeometry.ts` treats each edge as a
polyline from its start corner, through its nodes in `t` order, to its end
corner, and fills the interior with a bilinearly blended **Coons patch**:

```
P(u, v) = (1−v)·top(u) + v·bottom(u) + (1−u)·left(v) + u·right(v)
          − [ (1−u)(1−v)·TL + u(1−v)·TR + uv·BR + (1−u)v·BL ]
```

- `u` and `v` run 0–1 across and down the image.
- `top(u)`, `bottom(u)`, `left(v)` and `right(v)` sample the edge
  polylines. Bottom and left run against their stored direction, so they
  sample at `1 − u` and `1 − v`.

Properties worth knowing:

| Property | Why it matters |
| --- | --- |
| With no edge nodes, every edge is straight and the result is **exactly bilinear**: the classic quad warp. | Existing four-corner calibration is unchanged by the feature. Verified numerically (error ~2e-8, float32 rounding). |
| The image's boundary passes **exactly through** every corner and node. | What you pin is what you get. |
| Moving a node on one edge never moves the opposite edge. | Edits stay local. |
| The interior blends smoothly between all four edges. | Content bends to follow arches, cuts and notches instead of being clipped. |

Implementation notes:
- Edge curves are sampled once per grid line (4 × 49 samples), not once
  per vertex.
- The grid is written straight into the existing Three.js position
  buffer; no allocation per drag frame.
- Edges are straight between nodes. A curve needs several nodes, and
  smooth (spline) edges are on the roadmap.
- Folding is not prevented. Dragging a node past its neighbour, or across
  the opposite edge, makes the patch fold over itself. There's no guard
  yet.

## Perspective warp

The bilinear warp spreads content *evenly* between the corners. That's
wrong for the most common real case, a flat surface at an angle to the
projector (a wall, a box face, a door): a real plane foreshortens, so
the far side should get less of the image, and the diagonals should
cross at the surface's true center, not the shape's midpoint. Bilinear
also bends straight content lines that aren't parallel to an edge.

`warp: 'perspective'` uses the **homography** H that maps the unit
square onto the four corners (Heckbert's closed form, `squareToQuad()`).
Edge nodes still work: each edge's offset from H's straight edge is
blended in, Coons-style, on top of H instead of on top of the bilinear
blend:

```
P(u, v) = H(u, v) + (1−v)·Δtop(u) + v·Δbottom(u) + (1−u)·Δleft(v) + u·Δright(v)
```

Edges are still straight polylines through their nodes, but content is
spread along each segment with the same perspective spacing H gives that
edge (`evalEdge` with the corners' perspective weights).

| Property | Why it matters |
| --- | --- |
| No edge nodes → exactly H. | A true perspective view of a flat surface. |
| Adding a node (stepper or double-click) moves nothing. | The node's `t` is solved from where it lands (`segmentContentParam`), so it pins the content already there. |
| A parallelogram gives the same result as bilinear. | Nothing to foreshorten. |
| Non-convex corners (a dart or bow-tie) fall back to bilinear. | No flat surface looks like that; the drawer says so instead of silently changing. |

The 48×48 mesh is interpolated affinely per triangle, which is close
enough to true perspective at that density (sub-pixel error).

## Alignment grid

`showGrid` overlays a grid drawn by a fragment shader in the content's
**UV space** on a second mesh that shares the warped geometry, so it
bends, tilts and foreshortens exactly like the content. Thin lines every
1/8, a bolder center cross and border, faint diagonals, with a dark halo
for contrast over bright media. Line widths use `fwidth()` so they stay
constant in pixels however the surface is stretched. Content opacity
doesn't affect it.

## Masks

`Surface.mask` keeps light off the parts of a surface you don't want lit:
everything around an object, a window in a wall. It's the first step of
"scan an object" (photo → background removed → masked surface), and it's
useful on its own today.

**Model.** A mask is a grayscale PNG in the surface's **content space** (u
across, v down; white = lit), stored content-addressed in
`userData/masks/<sha256>.png` by `main/masks/maskStore.ts` and served as
`mirrorcat-media://mask/<id>`. The surface holds `{ id, invert, grow,
feather }` (`shared/mask.ts`). Because the mask lives in UV space it moves
and bends with the surface: nudge a corner after masking and the cut-out
stays on the object. Masks are kept out of the media library (they aren't
media you'd reuse, and painting saves a new one every few strokes); files
no saved scene or backup refers to are swept on launch.

**Rendering.** A third mesh shares the warped geometry, drawn after the
content and before the grid. Its shader outputs only an alpha `m`, and its
blend mode (`dst × srcAlpha` for color and alpha) multiplies whatever this
surface has drawn so far by `m`. Each surface has its own canvas, so
nothing else is affected, and the content material is untouched. The grid
stays unmasked, so it still helps you line the whole surface up.

**Grow / feather are free.** When a mask loads, the renderer turns it into
a **signed distance field** (`encodeSignedDistanceField`, Felzenszwalb's
linear-time transform, at ≤1024 px), stored as one byte per pixel with the
edge at 128. The shader decodes the distance (as a fraction of the mask's
shorter side), flips it for invert, adds grow and smoothsteps over the
feather width (at least about a pixel, via `fwidth`, so a crisp edge is
still antialiased). The sliders are uniforms: no recomputation. Fields are
cached by id.

**Mask mode** (M, Edit ▸ Edit Mask ⇧⌘M, or click the mask well in the
drawer). The mask bar takes the prompt bar's slot under the stage, so
nothing moves; the selected surface's handles step aside. Two tools share
one Light / Dark switch (X):

- **Outline** (O, the default for a new mask): click points around a shape;
  close by double-clicking, clicking the first point, or Enter. Backspace
  drops a point, Esc cancels. The first *light* outline on a fully lit
  surface darkens everything else ("light only this"); later outlines add
  to or cut from the lit area. Each edge is subdivided and mapped through
  the drawn mesh (`outlineToContent`), so the shape lands where it was drawn
  under any warp.
- **Brush** (B): drag to paint; `[` `]` size. Each stamp is drawn as the
  ellipse that the warp turns back into a circle on screen (canvas
  transform diag(W, H)·J⁻¹, J from `pickWarpGrid`).

**Seeing what's hidden.** In the editor, the selected surface previews its
mask: hidden areas stay faintly visible behind diagonal hatching (the mask
pass multiplies by a striped 0.16/0.42 instead of 0) so you can aim when
bringing light back. The projector never previews -- hidden is unlit.

While mask mode is open the editor uses the working canvas itself as the
mask; 350 ms after each change it's saved and set on the surface (projector
+ autosave). ⌘Z / ⇧⌘Z step outline points and mask edits (12 levels).
Mask mode ends with Done, Esc, M, selecting another surface, or hiding /
deleting this one; unsaved changes are saved first.

**Drawer.** One well (the mask thumbnail; click to edit, drop an image on
it), one Edge (softness) slider, and "…" for invert, grow, replace with an
image (native file dialog via `mask:pick-image`) and remove. When the
surface's picture has a transparent background, the drawer offers "Light
only the image" once.

**Images as masks.** Any PNG/JPEG/WebP becomes a mask in the renderer
(`imageToMaskPng`): images with transparency use their alpha (cut-outs,
like a photo with the background removed), opaque ones their brightness.

**Limits.** Grow/feather units follow the mask's shorter side, so on a
surface stretched far from the mask's proportions they're slightly
anisotropic. Mask changes aren't in undo history (like warp/grid). The
projector updates per stroke, not per pointer move.

## The editor overlay

On top of the WebGL canvas, `ProjectionCanvas` draws the editing UI in the
DOM. The outline is SVG; the handles are positioned `div`s.

```
z 2  ● corner targets   ◆ edge-node diamonds     ← take pointer input
z 1  SVG: tint fill, dark halo, 2px colored outline,
          invisible 14px double-click strips per segment
z 0  WebGL canvas (pointer-events: none)
```

- **Shared coordinates.** The SVG uses a `0 0 1 1` viewBox stretched to
  the container, and handles are positioned with `left/top` percentages.
  The overlay uses the same normalized coordinates as the mesh, so they
  line up by construction.
- **Canvas sizing.** The WebGL canvas is forced to fill its container in
  CSS. Three.js is told not to size it, and without this, on retina
  displays it rendered at 2× and drifted away from the handles.
- **Canvas order.** The engine inserts its canvas *before* the overlay
  (`prepend`). When it was appended it sat on top of the overlay and
  swallowed double-clicks.
- **Fill tint.** Empty surfaces get a strong tint of their outline color,
  22% (12% when ghosted), so they stand out from the black frame. Once
  content exists, the tint drops to 6% so it doesn't wash out the image.

## Editing interactions

| Action | How | Code |
| --- | --- | --- |
| Move a corner | Drag the round target (36px hit area). | `startDrag({kind:'corner'})` |
| Resize without warping | Hold **Shift** while dragging a corner: the surface snaps to an upright rectangle in the media's proportions, anchored at the opposite corner. A lock pill shows the ratio. | `proportionalCorners` (`shared/proportionalResize.ts`) |
| Restack surfaces | Drag a row in the sidebar (top = front), or **Alt+↑ / Alt+↓** on a focused row. | `moveSurface`, `stepSurface` |
| Move an edge node | Drag the diamond (28px hit area). | `startDrag({kind:'node'})`, `moveEdgeNode` |
| Add a node at a spot | Double-click an outline segment (cursor shows "copy"). | `handleSegmentDoubleClick`, `insertEdgeNode` |
| Add a node automatically | **+** in the drawer: midpoint of the longest segment. | `addNodeOnLongestSegment` |
| Remove a specific node | Click it (it fills in), then press Delete or Backspace. | `handleNodeKeyDown`, `removeEdgeNode` |
| Remove the newest node | **−** in the drawer. | `removeNewestEdgeNode` |
| Show or hide a surface | The dot beside its name in the sidebar. | `updateSurfaceSettings({visible})` |
| Undo / redo a shape change | ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y on Windows), or Edit ▸ Undo / Redo. One step per drag, insert, or delete. | `state/shapeHistory.ts` |

Drag details:
- **Grab offset.** The offset between the pointer and the point is kept
  for the whole drag, so grabbing the edge of a target doesn't make it
  jump.
- **Pointer capture.** A fast drag keeps tracking even when the cursor
  leaves the handle.
- **Clamping.** Positions are clamped to the frame (0–1).
- **Coordinates.** Pointer math uses the container's content box,
  excluding its border.
- **Focus as selection.** Node "selection" is just keyboard focus, which
  is also what makes nodes reachable with Tab.

Only the **selected** surface is editable. Other visible surfaces render
as dashed "ghosts", so you can line shapes up against each other without
grabbing the wrong one.

### Stacking order

`SceneState.surfaces` is back to front: later entries are drawn on top,
on the projector and in the editor alike. The sidebar shows that list
reversed (top row = front), like a layers panel. New surfaces go on top.

The editor draws every surface's *content* in its true stacking slot, so
the preview matches the wall. The selected surface's outline and handles
are a second, `contentless` `ProjectionCanvas` (no WebGL, no media) layered
above everything. That way you can still grab the corners of a surface
that sits behind others. (Before restacking existed, the editor lifted the
selected surface to the top, which made the preview disagree with the
projector.)

### Shift-drag: resize without warping

With Shift held on a corner drag (pressed before or during it), the shape
becomes an upright rectangle with the media's width:height. The ratio
comes from the library asset, or from the surface's current proportions
if it has no media yet, or a video hasn't been measured. Because the shape
matches the media exactly, the corner-pin maps it with no distortion: the
media scales, it doesn't warp. Releasing Shift mid-drag returns to free
corner dragging.

- The **opposite corner is the anchor**, and the dragged corner can't cross
  it. Growth direction is fixed by which corner you hold, so the media
  can't flip, and the dragged corner stays under the cursor.
- The rectangle is **clamped to the frame** and kept at least 16px.
- Maths is in **projector pixels**, so 16:9 means 16:9 on the wall.
- **Edge points scale with the surface.** Each node is captured once at
  drag start as (position along its edge's chord, offset from it, relative
  to chord length), then re-placed on the new edges, so bends grow and
  shrink with the shape. This is provisional: Devin wants to revisit
  scale vs. remove after trying it.

## Colors

`SURFACE_PALETTE` in `src/shared/types.ts` lists eight softened primaries,
ordered so consecutive colors contrast:

teal `#5FE7D6` · coral `#FF6B6B` · yellow `#FFD166` · blue `#4D9FFF` ·
violet `#B388FF` · mint `#7BD88F` · apricot `#FF9F5A` · rose `#FF7EB6`

`nextSurfaceColor()` returns the first color no surface is using (a color
picked by hand counts as used), then cycles once all eight are taken.

## Performance notes

- Each surface is its **own WebGL context**, in each window. Browsers cap
  live contexts at roughly 16 per page. At around a dozen surfaces, move
  to one shared Three.js scene per window with one mesh per surface.
- Each engine runs a **continuous** `requestAnimationFrame` render loop,
  even when nothing changes. That's fine on a plugged-in laptop; switch to
  render-on-change if battery or fan noise becomes a complaint.

## Undo / redo

Shape history (corners and edge nodes) lives in
`src/renderer/src/state/shapeHistory.ts`, outside the scene store, so it is
never synced to the projector or autosaved.

- **Every shape edit goes through `editCorners` / `editEdgeNodes`.** Never
  call the store's `updateCorners` / `updateEdgeNodes` from UI code, or
  that edit won't be undoable.
- **One step per gesture.** `ProjectionCanvas` calls `beginShapeGesture`
  on pointerdown and `endShapeGesture` on pointerup. Only the first change
  in a gesture records a snapshot, so a whole drag (including a Shift-drag
  that moves corners *and* nodes) undoes in one go. A click that doesn't
  move records nothing.
- **Refused edits aren't steps.** Geometry helpers return the same object
  when an insert is refused; identical input is skipped.
- **Undo selects the surface it changed**, so it's never invisible.
  Steps for surfaces that have since been deleted are skipped.
- Capped at 100 steps. Undo is ignored mid-drag.

**Routing.** The menu bar's Edit ▸ Undo / Redo is custom
(`src/main/appMenu.ts`), because Electron's stock items only undo typing.
Main sends `edit:command` to the control window, even when the projector
window is focused. The control window then checks focus: in a text field
the command undoes typing as usual (`document.execCommand`); anywhere else
it steps shape history.
