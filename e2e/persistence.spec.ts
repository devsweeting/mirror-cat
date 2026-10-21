import { expect, test } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createSurface } from '../src/shared/types'
import { cssLeft, dragBy, launchApp } from './helpers'

const seeded = {
  version: 1,
  savedAt: 0,
  surfaces: [createSurface('door', 'Door'), createSurface('shelf', 'Shelf')]
}

async function readScene(dir: string, file = 'scene.json') {
  return JSON.parse(await readFile(join(dir, file), 'utf8')) as {
    surfaces: { name: string; corners: { x: number; y: number }[] }[]
  }
}

test('restores the saved scene and backs it up before the first write', async () => {
  const ctx = await launchApp({ scene: seeded })
  try {
    const list = ctx.page.getByRole('list', { name: 'Surfaces, front to back' })
    await expect(list.getByText('Door')).toBeVisible()
    await expect(list.getByText('Shelf')).toBeVisible()

    // Edit the selected surface (the editor selects the first one).
    const corner = ctx.page.locator('.corner-handle').first()
    const label = (await corner.getAttribute('aria-label'))!
    await dragBy(ctx.page, label, 50, 20)

    await expect
      .poll(
        async () =>
          (await readScene(ctx.userData, 'scene.prev.json').catch(() => null))?.surfaces.length
      )
      .toBe(2)
    const backup = await readScene(ctx.userData, 'scene.prev.json')
    expect(backup.surfaces.map((s) => s.name)).toEqual(['Door', 'Shelf'])
    expect(backup.surfaces[0].corners).toEqual(seeded.surfaces[0].corners)
  } finally {
    await ctx.close()
  }
})

test('quitting right after an edit still saves it', async () => {
  const ctx = await launchApp({ scene: seeded })
  const corner = ctx.page.locator('.corner-handle').first()
  const label = (await corner.getAttribute('aria-label'))!
  await dragBy(ctx.page, label, 80, 40)
  const left = parseFloat(await cssLeft(ctx.page, label)) / 100
  // Let the edit reach main (one animation frame), then quit well inside
  // the 400 ms autosave debounce.
  await ctx.page.waitForTimeout(100)
  await ctx.app.close()

  const saved = await readScene(ctx.userData)
  const xs = saved.surfaces.flatMap((s) => s.corners.map((c) => c.x))
  expect(xs.some((x) => Math.abs(x - left) < 1e-6)).toBe(true)
  await ctx.close()
})
