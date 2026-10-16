import { promises as fs } from 'fs'
import type {
  Corner,
  CornerSet,
  EdgeNode,
  EdgeNodeSet,
  SceneState,
  Surface
} from '../../shared/types'
import { DEFAULT_OUTLINE_COLOR } from '../../shared/types'
import { isNotFound, quarantine, writeFileAtomic } from '../fsUtil'

const FILE_VERSION = 1
/** Long enough to coalesce a whole corner drag into one write. */
const SAVE_DELAY_MS = 400

interface SavedScene {
  version: number
  savedAt: number
  surfaces: Surface[]
}

/**
 * Keeps `<userData>/scene.json` in step with the control window. It piggybacks
 * on the existing scene:update stream (which already arrives batched to one
 * message per animation frame) and debounces writes on top of that.
 *
 * Only surfaces are saved: which display is projecting is a live hardware
 * state and is deliberately not restored on launch.
 */
export class SceneAutosave {
  private pending: SceneState | null = null
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  get hasPendingWrite(): boolean {
    return this.pending !== null
  }

  async load(): Promise<Surface[] | null> {
    let raw: unknown
    try {
      raw = JSON.parse(await fs.readFile(this.path, 'utf8'))
    } catch (error) {
      if (isNotFound(error)) return null
      const moved = await quarantine(this.path)
      console.error(`[autosave] scene.json unreadable, moved to ${moved}`, error)
      return null
    }
    const surfaces = (raw as Partial<SavedScene>)?.surfaces
    if (!Array.isArray(surfaces)) return null
    return surfaces.map(normalizeSurface).filter((s): s is Surface => s !== null)
  }

  schedule(scene: SceneState): void {
    this.pending = scene
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS)
  }

  /** Write any pending change now (used on quit). */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const scene = this.pending
    if (!scene) return this.writing
    this.pending = null
    const data: SavedScene = {
      version: FILE_VERSION,
      savedAt: Date.now(),
      surfaces: scene.surfaces
    }
    this.writing = this.writing
      .then(() => writeFileAtomic(this.path, JSON.stringify(data, null, 2)))
      .catch((error) => console.error('[autosave] write failed', error))
    return this.writing
  }
}

/**
 * Defensive read of one saved surface. Fills in fields added after the file
 * was written (so older saves keep loading) and drops anything too broken
 * to render, instead of crashing the editor on launch.
 */
function normalizeSurface(value: unknown): Surface | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Partial<Surface>
  if (typeof s.id !== 'string' || !Array.isArray(s.corners) || s.corners.length !== 4) return null
  if (!s.corners.every(isCorner)) return null

  const edgeNodes: EdgeNodeSet =
    Array.isArray(s.edgeNodes) && s.edgeNodes.length === 4
      ? (s.edgeNodes.map((edge) =>
          Array.isArray(edge) ? edge.filter(isEdgeNode) : []
        ) as EdgeNodeSet)
      : [[], [], [], []]

  return {
    id: s.id,
    name: typeof s.name === 'string' && s.name.trim() ? s.name : 'Surface',
    corners: s.corners.map((c) => ({ x: c.x, y: c.y })) as CornerSet,
    edgeNodes,
    assetId: typeof s.assetId === 'string' ? s.assetId : null,
    fit: s.fit === 'fill' ? 'fill' : 'stretch',
    loop: s.loop !== false,
    playToken: 0,
    outlineColor:
      typeof s.outlineColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.outlineColor)
        ? s.outlineColor
        : DEFAULT_OUTLINE_COLOR,
    opacity: typeof s.opacity === 'number' ? Math.min(1, Math.max(0, s.opacity)) : 1,
    visible: s.visible !== false
  }
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function isCorner(c: unknown): c is Corner {
  return !!c && isFiniteNumber((c as Corner).x) && isFiniteNumber((c as Corner).y)
}

function isEdgeNode(n: unknown): n is EdgeNode {
  const node = n as EdgeNode
  return (
    !!node &&
    typeof node.id === 'string' &&
    isFiniteNumber(node.seq) &&
    isFiniteNumber(node.t) &&
    isCorner(node)
  )
}
