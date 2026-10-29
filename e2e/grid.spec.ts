import { expect, test } from '@playwright/test'
import { createSurface, type CornerSet, type SceneState } from '../src/shared/types'
import { launchApp, type Launched } from './helpers'

// The same wall-at-an-angle shape twice: perspective on the left, even
// (bilinear) on the right, both with the grid on.
const LEFT: CornerSet = [
  { x: 0.12, y: 0.2 },
  { x: 0.4, y: 0.28 },
  { x: 0.4, y: 0.72 },
  { x: 0.12, y: 0.8 }
]
const RIGHT = LEFT.map((c) => ({ x: c.x + 0.46, y: c.y })) as CornerSet

function scene(): SceneState {
  const a = { ...createSurface('s-1', 'Perspective'), corners: LEFT, showGrid: true }
  const b = {
    ...createSurface('s-2', 'Even'),
    corners: RIGHT,
    warp: 'bilinear' as const,
    showGrid: true
  }
  return { surfaces: [a, b], outputDisplayId: null }
}

let launched: Launched

test.beforeAll(async () => {
  launched = await launchApp({ scene: scene() })
})

test.afterAll(async () => {
  await launched?.close()
})

test('the alignment grid draws (shader compiles) with no console errors', async () => {
  const { page, problems } = launched
  await expect(page.locator('canvas.projection-gl').first()).toBeVisible()
  // Give the on-demand renderer a frame.
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/grid-perspective-vs-even.png' })
  expect(problems.filter((p) => /shader|WebGL|THREE/i.test(p))).toEqual([])
  expect(problems).toEqual([])
})

test('the drawer toggles the grid and explains a non-convex fallback', async () => {
  const { page } = launched
  await page.locator('.surface-header', { hasText: 'Perspective' }).click()
  const drawer = page.locator('.surface-drawer')
  const grid = drawer.getByRole('radiogroup', { name: 'Alignment grid' })
  await grid.getByRole('radio', { name: 'Off' }).click()
  await expect(grid.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
  await grid.getByRole('radio', { name: 'On' }).click()
  await expect(grid.getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true')

  // Warp lives in the collapsed "Shape" section.
  await drawer.getByRole('button', { name: /Shape/ }).click()
  const warp = drawer.getByRole('radiogroup', { name: 'Warp' })
  await expect(warp.getByRole('radio', { name: 'Perspective' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect(drawer.getByRole('status')).toHaveCount(0)

  // Drag the top-right corner in past the diagonal: a concave "dart".
  const handle = page.getByLabel('Perspective top-right corner')
  const stage = page.locator('canvas.projection-gl').first()
  const box = (await stage.boundingBox())!
  const from = (await handle.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.5, { steps: 8 })
  await page.mouse.up()
  await expect(drawer.getByRole('status')).toContainText('spread evenly')
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'test-results/grid-drawer-fallback.png' })
})
