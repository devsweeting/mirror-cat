import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SceneAutosave, normalizeSurface } from './sceneAutosave'
import { DEFAULT_OUTLINE_COLOR, createSurface, type SceneState } from '../../shared/types'

let dir: string
let path: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'mirrorcat-autosave-'))
  path = join(dir, 'scene.json')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const scene = (...names: string[]): SceneState => ({
  surfaces: names.map((n) => createSurface(`id-${n}`, n)),
  outputDisplayId: null
})

async function readJson(file: string) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

describe('SceneAutosave', () => {
  it('loads nothing on first launch', async () => {
    expect(await new SceneAutosave(path).load()).toBeNull()
  })

  it('writes the latest scheduled scene on flush', async () => {
    const autosave = new SceneAutosave(path)
    autosave.schedule(scene('A'))
    autosave.schedule(scene('A', 'B'))
    expect(autosave.hasPendingWrite).toBe(true)
    await autosave.flush()
    expect(autosave.hasPendingWrite).toBe(false)
    const saved = await readJson(path)
    expect(saved.version).toBe(1)
    expect(saved.surfaces.map((s: { name: string }) => s.name)).toEqual(['A', 'B'])
    expect(await new SceneAutosave(path).load()).toHaveLength(2)
  })

  it('reports a write that is already running as pending (so quit waits for it)', async () => {
    const autosave = new SceneAutosave(path)
    autosave.schedule(scene('A'))
    const writing = autosave.flush()
    expect(autosave.hasPendingWrite).toBe(true)
    await writing
    expect(autosave.hasPendingWrite).toBe(false)
  })

  it('debounces: nothing is written until the delay passes', async () => {
    const autosave = new SceneAutosave(path)
    autosave.schedule(scene('A'))
    await expect(fs.access(path)).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 600))
    await autosave.flush()
    expect((await readJson(path)).surfaces).toHaveLength(1)
  })

  it('ignores updates after close()', async () => {
    const autosave = new SceneAutosave(path)
    autosave.schedule(scene('A'))
    await autosave.close()
    autosave.schedule(scene('A', 'B', 'C'))
    expect(autosave.hasPendingWrite).toBe(false)
    expect((await readJson(path)).surfaces).toHaveLength(1)
  })

  describe('backup', () => {
    it('keeps the launch-time scene in scene.prev.json before the first write', async () => {
      const first = new SceneAutosave(path)
      first.schedule(scene('Door', 'Shelf'))
      await first.flush()

      // Next launch writes an empty scene over it (the bug this guards).
      const second = new SceneAutosave(path)
      second.schedule(scene())
      await second.flush()
      expect((await readJson(path)).surfaces).toHaveLength(0)
      expect((await readJson(second.backupPath)).surfaces).toHaveLength(2)

      // A third launch must not replace the good backup with the empty file.
      const third = new SceneAutosave(path)
      third.schedule(scene())
      await third.flush()
      expect((await readJson(third.backupPath)).surfaces).toHaveLength(2)
    })

    it('backs up only once per session', async () => {
      const first = new SceneAutosave(path)
      first.schedule(scene('A'))
      await first.flush()
      const second = new SceneAutosave(path)
      second.schedule(scene('A', 'B'))
      await second.flush()
      second.schedule(scene('A', 'B', 'C'))
      await second.flush()
      expect((await readJson(second.backupPath)).surfaces).toHaveLength(1)
    })

    it('quarantines a corrupt scene.json and restores from the backup', async () => {
      const autosave = new SceneAutosave(path)
      await fs.writeFile(
        autosave.backupPath,
        JSON.stringify({ version: 1, surfaces: [createSurface('x', 'Kept')] })
      )
      await fs.writeFile(path, '{ not json')
      const surfaces = await autosave.load()
      expect(surfaces?.map((s) => s.name)).toEqual(['Kept'])
      const files = await fs.readdir(dir)
      expect(files.some((f) => f.startsWith('scene.json.corrupt-'))).toBe(true)
      expect(files).not.toContain('scene.json')
    })

    it('uses the backup when scene.json is missing', async () => {
      const autosave = new SceneAutosave(path)
      await fs.writeFile(
        autosave.backupPath,
        JSON.stringify({ surfaces: [createSurface('x', 'Kept')] })
      )
      expect(await autosave.load()).toHaveLength(1)
    })
  })
})

describe('normalizeSurface', () => {
  it('fills in fields added after a file was written', () => {
    const s = normalizeSurface({
      id: 'old',
      corners: createSurface('a', 'a').corners
    })
    expect(s).toMatchObject({
      id: 'old',
      name: 'Surface',
      edgeNodes: [[], [], [], []],
      assetId: null,
      fit: 'stretch',
      loop: true,
      playToken: 0,
      outlineColor: DEFAULT_OUTLINE_COLOR,
      opacity: 1,
      visible: true,
      // Older saves were calibrated with the even warp; they must not shift.
      warp: 'bilinear',
      showGrid: false
    })
  })

  it('keeps the warp mode and grid toggle', () => {
    const corners = createSurface('a', 'a').corners
    expect(
      normalizeSurface({ id: 'x', corners, warp: 'perspective', showGrid: true })
    ).toMatchObject({ warp: 'perspective', showGrid: true })
    expect(normalizeSurface({ id: 'x', corners, warp: 'fisheye', showGrid: 'yes' })).toMatchObject({
      warp: 'bilinear',
      showGrid: false
    })
  })

  it('drops surfaces too broken to render', () => {
    const corners = createSurface('a', 'a').corners
    expect(normalizeSurface(null)).toBeNull()
    expect(normalizeSurface({ id: 1, corners })).toBeNull()
    expect(normalizeSurface({ id: 'x', corners: corners.slice(0, 3) })).toBeNull()
    expect(
      normalizeSurface({ id: 'x', corners: [...corners.slice(0, 3), { x: NaN, y: 0 }] })
    ).toBeNull()
  })

  it('clamps and sanitises values', () => {
    const base = createSurface('a', 'a')
    const s = normalizeSurface({
      ...base,
      opacity: 7,
      outlineColor: 'red; background: url(x)',
      playToken: 42,
      edgeNodes: [[{ id: 'n', seq: 1, t: 0.5, x: 0.5, y: 0.1 }, { id: 'bad' }], 'nope', [], []]
    })
    expect(s?.opacity).toBe(1)
    expect(s?.outlineColor).toBe(DEFAULT_OUTLINE_COLOR)
    expect(s?.playToken).toBe(0)
    expect(s?.edgeNodes[0]).toHaveLength(1)
    expect(s?.edgeNodes[1]).toEqual([])
  })
})
