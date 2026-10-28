import { expect, test } from '@playwright/test'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { createSurface, type CornerSet, type SceneState } from '../src/shared/types'
import { launchApp, type Launched } from './helpers'

const CORNERS: CornerSet = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.25 },
  { x: 0.8, y: 0.75 },
  { x: 0.2, y: 0.8 }
]

function scene(): SceneState {
  return {
    surfaces: [{ ...createSurface('s-1', 'Box'), corners: CORNERS, showGrid: true }],
    outputDisplayId: null
  }
}

async function savedMask(userData: string): Promise<{ id: string } | null> {
  const saved = JSON.parse(await readFile(join(userData, 'scene.json'), 'utf8'))
  return saved.surfaces[0].mask
}

let launched: Launched

test.beforeAll(async () => {
  launched = await launchApp({ scene: scene() })
})

test.afterAll(async () => {
  await launched?.close()
})

test('paint a mask on the stage, then tune and remove it', async () => {
  const { page, userData, problems } = launched
  await page.locator('.surface-header', { hasText: 'Box' }).click()
  const drawer = page.locator('.surface-drawer')

  await drawer.getByRole('button', { name: 'Paint' }).click()
  const toolbar = page.getByRole('toolbar', { name: /Painting the mask on Box/ })
  await expect(toolbar).toBeVisible()
  // Handles step aside for the brush.
  await expect(page.getByLabel('Box top-left corner')).toHaveCount(0)

  // Hide a stripe across the middle of the surface.
  const layer = page.getByTestId('mask-paint-layer')
  const box = (await layer.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 12 })
  await page.mouse.up()
  await expect(toolbar.getByRole('button', { name: 'Undo stroke' })).toBeEnabled()

  // Saved a moment after the stroke, while still painting.
  await expect.poll(() => savedMask(userData), { timeout: 5000 }).not.toBeNull()
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'test-results/mask-painted.png' })

  await toolbar.getByRole('button', { name: 'Done' }).click()
  await expect(toolbar).toHaveCount(0)
  await expect(page.getByLabel('Box top-left corner')).toBeVisible()
  await expect(drawer.getByRole('img', { name: 'Current mask' })).toBeVisible()

  const mask = (await savedMask(userData))!
  expect(mask.id).toMatch(/^[a-f0-9]{64}$/)
  expect(await readdir(join(userData, 'masks'))).toContain(`${mask.id}.png`)

  // Invert and feather apply live; they're saved with the scene.
  await drawer
    .getByRole('radiogroup', { name: 'Invert mask' })
    .getByRole('radio', { name: 'On' })
    .click()
  await drawer.getByLabel('Feather').fill('4')
  await expect
    .poll(async () => (await savedMask(userData)) as unknown as Record<string, unknown>)
    .toMatchObject({ invert: true, feather: 0.04 })
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'test-results/mask-inverted-feathered.png' })

  await drawer.getByRole('button', { name: 'Remove mask' }).click()
  await expect(drawer.getByRole('img', { name: 'Current mask' })).toHaveCount(0)
  await expect.poll(() => savedMask(userData)).toBeNull()

  expect(problems).toEqual([])
})

test('Escape finishes painting', async () => {
  const { page } = launched
  const drawer = page.locator('.surface-drawer')
  await drawer.getByRole('button', { name: 'Paint' }).click()
  await expect(page.getByTestId('mask-paint-layer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mask-paint-layer')).toHaveCount(0)
})
