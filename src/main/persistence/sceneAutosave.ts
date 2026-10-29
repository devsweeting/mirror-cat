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
import { ASSET_ID_PATTERN } from '../../shared/media'
import { MAX_EDGE_NODES } from '../../shared/surfaceGeometry'
import { normalizeMask } from '../../shared/mask'
import { isNotFound, quarantine, writeFileAtomic } from '../fsUtil'

const FILE_VERSION = 1
const MAX_SURFACE_NAME = 120
/** Long enough to coalesce a whole corner drag into one write. */
const SAVE_DELAY_MS = 400

interface SavedScene {
  version: number
  savedAt: number
  surfaces: Surface[]
}

type ReadResult = { kind: 'ok'; surfaces: Surface[] } | { kind: 'missing' } | { kind: 'corrupt' }

/**
 * Keeps `<userData>/scene.json` in step with the control window. It piggybacks
 * on the existing scene:update stream (which already arrives batched to one
 * message per animation frame) and debounces writes on top of that.
 *
 * Only surfaces are saved: which display is projecting is a live hardware
 * state and is deliberately not restored on launch.
 *
 * Safety net: before the first write of each session, the file as it stood
 * at launch is copied to `scene.prev.json` (only if it had surfaces). A bad
 * start-up that writes an empty or default scene over a good calibration
 * can then be recovered, and load() falls back to it if scene.json is
 * missing or unreadable.
 */
export class SceneAutosave {
  private pending: SceneState | null = null
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private inFlight = 0
  private backedUp = false
  private closed = false

  constructor(private readonly path: string) {}

  get backupPath(): string {
    return this.path.replace(/\.json$/, '') + '.prev.json'
  }

  /** True while a change is waiting to be written *or* a write is under way. */
  get hasPendingWrite(): boolean {
    return this.pending !== null || this.inFlight > 0
  }

  async load(): Promise<Surface[] | null> {
    const main = await readScene(this.path)
    if (main.kind === 'ok') return main.surfaces
    if (main.kind === 'corrupt') {
      const moved = await quarantine(this.path)
      console.error(`[autosave] scene.json unreadable, moved to ${moved}`)
    }
    const backup = await readScene(this.backupPath)
    if (backup.kind === 'ok') {
      if (main.kind === 'corrupt') console.warn('[autosave] restored from scene.prev.json')
      return backup.surfaces
    }
    return null
  }

  /**
   * Mask ids referenced by scene.json and scene.prev.json, so masks nothing
   * points at can be swept on launch. Null when scene.json exists but can't
   * be read -- then nothing is safe to delete.
   */
  async maskIdsInUse(): Promise<Set<string> | null> {
    const ids = new Set<string>()
    for (const path of [this.path, this.backupPath]) {
      const result = await readScene(path)
      if (result.kind === 'corrupt' && path === this.path) return null
      if (result.kind !== 'ok') continue
      for (const surface of result.surfaces) if (surface.mask) ids.add(surface.mask.id)
    }
    return ids
  }

  schedule(scene: SceneState): void {
    if (this.closed) return
    this.pending = scene
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS)
  }

  /** Write any pending change now, and wait for any write already under way. */
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
    this.inFlight += 1
    this.writing = this.writing
      .then(() => this.backupOnce())
      .then(() => writeFileAtomic(this.path, JSON.stringify(data, null, 2)))
      .catch((error) => console.error('[autosave] write failed', error))
      .finally(() => {
        this.inFlight -= 1
      })
    return this.writing
  }

  /** Final flush on quit; later scene updates are ignored. */
  close(): Promise<void> {
    const done = this.flush()
    this.closed = true
    return done
  }

  private async backupOnce(): Promise<void> {
    if (this.backedUp) return
    this.backedUp = true
    // Only a file worth keeping replaces the backup -- otherwise two bad
    // launches in a row would overwrite the good copy with the bad one.
    const current = await readScene(this.path)
    if (current.kind === 'ok' && current.surfaces.length > 0) {
      await fs.copyFile(this.path, this.backupPath)
    }
  }
}

async function readScene(path: string): Promise<ReadResult> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(path, 'utf8'))
  } catch (error) {
    return isNotFound(error) ? { kind: 'missing' } : { kind: 'corrupt' }
  }
  const surfaces = (raw as Partial<SavedScene>)?.surfaces
  if (!Array.isArray(surfaces)) return { kind: 'corrupt' }
  return {
    kind: 'ok',
    surfaces: surfaces.map((s) => normalizeSurface(s)).filter((s): s is Surface => s !== null)
  }
}

/**
 * Defensive read of one saved surface. Fills in fields added after the file
 * was written (so older saves keep loading) and drops anything too broken
 * to render, instead of crashing the editor on launch.
 */
export function normalizeSurface(value: unknown): Surface | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Partial<Surface>
  if (typeof s.id !== 'string' || !Array.isArray(s.corners) || s.corners.length !== 4) return null
  if (!s.corners.every(isCorner)) return null

  let budget = MAX_EDGE_NODES
  const edgeNodes: EdgeNodeSet =
    Array.isArray(s.edgeNodes) && s.edgeNodes.length === 4
      ? (s.edgeNodes.map((edge) => {
          const valid = Array.isArray(edge)
            ? edge.filter(isEdgeNode).map((n) => ({ id: n.id, seq: n.seq, t: n.t, x: n.x, y: n.y }))
            : []
          const kept = valid.slice(0, Math.max(0, budget))
          budget -= kept.length
          return kept
        }) as EdgeNodeSet)
      : [[], [], [], []]

  return {
    id: s.id,
    name:
      typeof s.name === 'string' && s.name.trim() ? s.name.slice(0, MAX_SURFACE_NAME) : 'Surface',
    corners: s.corners.map((c) => ({ x: c.x, y: c.y })) as CornerSet,
    edgeNodes,
    assetId: typeof s.assetId === 'string' && ASSET_ID_PATTERN.test(s.assetId) ? s.assetId : null,
    fit: s.fit === 'fill' ? 'fill' : 'stretch',
    loop: s.loop !== false,
    playToken: 0,
    outlineColor:
      typeof s.outlineColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.outlineColor)
        ? s.outlineColor
        : DEFAULT_OUTLINE_COLOR,
    opacity: typeof s.opacity === 'number' ? Math.min(1, Math.max(0, s.opacity)) : 1,
    visible: s.visible !== false,
    // Scenes saved before warp modes existed were calibrated with the even
    // (bilinear) warp; keep them looking exactly as they did.
    warp: s.warp === 'perspective' ? 'perspective' : 'bilinear',
    showGrid: s.showGrid === true,
    mask: normalizeMask(s.mask)
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
