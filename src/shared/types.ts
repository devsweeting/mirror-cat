import type { SurfaceMask } from './mask'

export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  isPrimary: boolean
}

export interface Corner {
  /** normalized 0..1, fraction of surface width */
  x: number
  /** normalized 0..1, fraction of surface height */
  y: number
}

/** Corner-pin points in order: top-left, top-right, bottom-right, bottom-left */
export type CornerSet = [Corner, Corner, Corner, Corner]

/**
 * An extra point on one of a surface's four edges, letting the outline (and
 * the warped content) follow non-rectangular shapes.
 */
export interface EdgeNode {
  /** Unique within the surface. */
  id: string
  /** Insertion order within the surface; the stepper's "−" removes the highest. */
  seq: number
  /**
   * Where along its edge this node sits in the *content*, 0..1 from the
   * edge's start corner to its end corner. Fixed at insertion; dragging the
   * node only moves where that slice of the image lands.
   */
  t: number
  /** Position in the projector frame, normalized 0..1 like corners. */
  x: number
  y: number
}

/**
 * Nodes for each edge, sorted by `t`. Edge i runs from corner i to corner
 * (i + 1) % 4: top (TL→TR), right (TR→BR), bottom (BR→BL), left (BL→TL).
 */
export type EdgeNodeSet = [EdgeNode[], EdgeNode[], EdgeNode[], EdgeNode[]]

/**
 * How an image maps onto a surface whose shape doesn't match its aspect
 * ratio. `stretch` distorts the image to the surface's four corners;
 * `fill` keeps the image's proportions and crops the overflow.
 */
export type SurfaceFit = 'stretch' | 'fill'

/**
 * How the content is spread between a surface's corners.
 *
 * `perspective` treats the surface as a flat plane seen at an angle (a
 * homography): straight lines stay straight and the far side is
 * foreshortened, so a wall or box face at an angle to the projector looks
 * undistorted. `bilinear` spreads the content evenly between the corners --
 * the classic quad warp, and what scenes saved before this option used.
 * Perspective falls back to bilinear while the four corners don't form a
 * convex shape (no flat plane could look like that). See
 * docs/surfaces-and-warping.md.
 */
export type WarpMode = 'perspective' | 'bilinear'

export interface Surface {
  id: string
  name: string
  corners: CornerSet
  edgeNodes: EdgeNodeSet
  /** Media library asset shown on this surface. Deleting the surface never deletes the asset. */
  assetId: string | null
  fit: SurfaceFit
  /** Videos: loop forever, or play once and hold the last frame. Ignored for images. */
  loop: boolean
  /**
   * Bumped to restart a video from the top. It's in the synced scene so the
   * projector restarts in step with the editor preview.
   */
  playToken: number
  /** Editor outline + handle color, as #rrggbb. Control window only -- never projected. */
  outlineColor: string
  /** Content opacity, 0..1. Applies on the projector as well as in the editor. */
  opacity: number
  /** Hidden surfaces aren't drawn in the editor or on the projector. */
  visible: boolean
  warp: WarpMode
  /**
   * Draw an alignment grid over the content, warped with it. Shown on the
   * projector too -- seeing it on the real wall is the point.
   */
  showGrid: boolean
  /**
   * Hides the parts of the surface outside a shape (an object's outline),
   * in the surface's own content space. See shared/mask.ts.
   */
  mask: SurfaceMask | null
}

/** The per-surface fields the settings drawer can edit. */
export type SurfaceSettings = Pick<
  Surface,
  'outlineColor' | 'opacity' | 'visible' | 'fit' | 'loop' | 'warp' | 'showGrid'
>

/**
 * Outline colors handed out to new surfaces, in order. A soft take on the
 * primaries plus a few neighbours: saturated enough to read instantly on the
 * black projector frame, but slightly warm and lifted so they sit together
 * rather than looking like default UI red/green/blue. Ordered so each next
 * color contrasts with the one before it.
 */
export const SURFACE_PALETTE = [
  '#5fe7d6', // teal (also the app's accent)
  '#ff6b6b', // coral red
  '#ffd166', // warm yellow
  '#4d9fff', // clear blue
  '#b388ff', // soft violet
  '#7bd88f', // mint green
  '#ff9f5a', // apricot orange
  '#ff7eb6' // rose pink
] as const

export const DEFAULT_OUTLINE_COLOR = SURFACE_PALETTE[0]

/**
 * First palette color no existing surface is using (case-insensitive, so a
 * color picked by hand that matches still counts). Once all are taken it
 * keeps cycling so neighbours in the list still differ.
 */
export function nextSurfaceColor(usedColors: readonly string[]): string {
  const used = new Set(usedColors.map((c) => c.toLowerCase()))
  const free = SURFACE_PALETTE.find((c) => !used.has(c))
  return free ?? SURFACE_PALETTE[usedColors.length % SURFACE_PALETTE.length]
}

/**
 * What gets synced to the output window and autosaved. Images aren't in
 * here -- surfaces reference library assets by id, and both windows load
 * them from the mirrorcat-media:// protocol -- so this stays a few KB.
 */
export interface SceneState {
  surfaces: Surface[]
  outputDisplayId: number | null
}

// Inset from the canvas edge so a new surface reads as a distinct shape
// against the background and all four handles are fully grabbable, instead
// of sitting half-clipped on the container border.
export const DEFAULT_CORNERS: CornerSet = [
  { x: 0.15, y: 0.15 },
  { x: 0.85, y: 0.15 },
  { x: 0.85, y: 0.85 },
  { x: 0.15, y: 0.85 }
]

export function createSurface(
  id: string,
  name: string,
  outlineColor: string = DEFAULT_OUTLINE_COLOR
): Surface {
  return {
    id,
    name,
    corners: DEFAULT_CORNERS.map((c) => ({ ...c })) as CornerSet,
    edgeNodes: [[], [], [], []],
    assetId: null,
    fit: 'stretch',
    loop: true,
    playToken: 0,
    outlineColor,
    opacity: 1,
    visible: true,
    warp: 'perspective',
    showGrid: false,
    mask: null
  }
}

/** An Edit-menu command forwarded from the app menu to the control window. */
export type EditCommand = 'undo' | 'redo'
