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

export interface Surface {
  id: string
  name: string
  corners: CornerSet
  contentId: string | null
}

export interface GeneratedContent {
  id: string
  prompt: string
  createdAt: number
  /** data URL (PNG) of the generated still frame, used as the surface texture */
  dataUrl: string
}

export interface SceneState {
  surfaces: Surface[]
  content: Record<string, GeneratedContent>
  outputDisplayId: number | null
}

export const DEFAULT_CORNERS: CornerSet = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 }
]

export function createSurface(id: string, name: string): Surface {
  return {
    id,
    name,
    corners: DEFAULT_CORNERS.map((c) => ({ ...c })) as CornerSet,
    contentId: null
  }
}
