import { expect, test } from '@playwright/test'
import {
  clickMenuItem,
  cssLeft,
  dragBy,
  importTestImage,
  launchApp,
  type Launched
} from './helpers'

const CORNER = 'Surface 1 top-left corner'
let ctx: Launched

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.close()
})

test('a corner drag is one undo step (Edit ▸ Undo / Redo)', async () => {
  const { app, page } = ctx
  const original = await cssLeft(page, CORNER)
  await dragBy(page, CORNER, 60, 30)
  const moved = await cssLeft(page, CORNER)
  expect(moved).not.toBe(original)

  await clickMenuItem(app, 'Undo')
  await expect.poll(() => cssLeft(page, CORNER)).toBe(original)
  await clickMenuItem(app, 'Redo')
  await expect.poll(() => cssLeft(page, CORNER)).toBe(moved)
  await clickMenuItem(app, 'Undo')
})

test('an idle editor draws nothing (render on demand)', async () => {
  const frames = await ctx.page.evaluate(async () => {
    let count = 0
    const original = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      count++
      return original(cb)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    window.requestAnimationFrame = original
    return count
  })
  // A per-surface render loop would be ~60 a second.
  expect(frames).toBeLessThanOrEqual(2)
})

test('deleting an image in use clears the surface and the file', async () => {
  const { page } = ctx
  const id = await importTestImage(page, 'e2e-delete')

  await page.locator('.topbar-library').click()
  const library = page.getByRole('complementary', { name: 'Media library' })
  await library.locator('.library-tile', { hasText: 'e2e-delete' }).click()
  await library.getByRole('button', { name: 'Use on Surface 1' }).click()
  await expect(library.getByRole('button', { name: 'On Surface 1' })).toBeVisible()
  await expect(page.locator('.editor-layer .projection-canvas:not(.empty)').first()).toBeVisible()

  // First "Delete" asks, the second (in the confirmation) does it.
  await library.getByRole('button', { name: 'Delete', exact: true }).click()
  await library.getByRole('button', { name: 'Delete', exact: true }).click()

  await expect
    .poll(() => page.evaluate(() => window.mirrorcat.media.list().then((l) => l.map((a) => a.id))))
    .not.toContain(id)
  await expect(page.locator('.editor-layer .projection-canvas.empty').first()).toBeVisible()
  await expect(library.getByRole('alert')).toHaveCount(0)
})
