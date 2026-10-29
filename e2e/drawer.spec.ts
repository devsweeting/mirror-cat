import { expect, test } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createSurface, type SceneState } from '../src/shared/types'
import { launchApp, type Launched } from './helpers'

function scene(): SceneState {
  return {
    surfaces: [createSurface('s-1', 'Door'), createSurface('s-2', 'Shelf', '#ff6b6b')],
    outputDisplayId: null
  }
}

async function saved(userData: string) {
  return JSON.parse(await readFile(join(userData, 'scene.json'), 'utf8')).surfaces as {
    id: string
    name: string
    outlineColor: string
  }[]
}

let launched: Launched

test.beforeAll(async () => {
  launched = await launchApp({ scene: scene() })
})

test.afterAll(async () => {
  await launched?.close()
})

test('the drawer shows everyday controls; shape settings are folded away', async () => {
  const { page } = launched
  await page.locator('.surface-header', { hasText: 'Door' }).click()
  const drawer = page.locator('.surface-drawer')
  await expect(drawer.getByRole('switch', { name: 'Alignment grid' })).toBeVisible()
  // Mask settings are folded into their own dropdown, summarized.
  await expect(drawer.getByRole('button', { name: /^Mask None/ })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Edit the mask on the stage' })).toBeHidden()
  await expect(drawer.getByLabel('Opacity')).toBeVisible()
  // No color strip or rename/delete buttons in the drawer itself.
  await expect(drawer.getByRole('radiogroup', { name: /Outline color/ })).toHaveCount(0)
  await expect(drawer.getByRole('button', { name: /Delete/ })).toHaveCount(0)

  const shape = drawer.getByRole('button', { name: /Shape/ })
  await expect(shape).toContainText('Perspective, 4 points')
  await expect(drawer.getByRole('radiogroup', { name: 'Warp' })).toBeHidden()
  await shape.click()
  await expect(drawer.getByRole('radiogroup', { name: 'Warp' })).toBeVisible()
  await drawer.getByRole('button', { name: 'Add edge point' }).click()
  await expect(shape).toContainText('Perspective, 5 points')
  await page.screenshot({ path: 'test-results/drawer-simplified.png' })
  await shape.click()
})

test('the row menu renames, recolors and deletes', async () => {
  const { page, userData } = launched
  await page.getByRole('button', { name: 'Door options' }).click()
  const menu = page.getByRole('dialog', { name: 'Door options' })
  await expect(menu.getByLabel('Surface name')).toBeFocused()
  await menu.getByLabel('Surface name').fill('Front door')
  await menu.getByRole('radio', { name: '#b388ff' }).click()
  await page.screenshot({ path: 'test-results/drawer-row-menu.png' })
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(page.locator('.surface-header', { hasText: 'Front door' })).toBeVisible()
  await expect
    .poll(async () => (await saved(userData)).find((s) => s.id === 's-1'))
    .toMatchObject({ name: 'Front door', outlineColor: '#b388ff' })

  await page.getByRole('button', { name: 'Front door options' }).click()
  const menu2 = page.getByRole('dialog', { name: 'Front door options' })
  await menu2.getByRole('button', { name: 'Delete surface' }).click()
  await expect(menu2.getByRole('alert')).toContainText('Delete Front door')
  await menu2.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.locator('.surface-header', { hasText: 'Front door' })).toHaveCount(0)
  await expect.poll(async () => (await saved(userData)).map((s) => s.id)).toEqual(['s-2'])
  expect(launched.problems).toEqual([])
})

test('a switch flips wherever you click it, even on the side already lit', async () => {
  const { page } = launched
  await page.locator('.surface-header', { hasText: 'Shelf' }).click()
  const grid = page.locator('.surface-drawer').getByRole('switch', { name: 'Alignment grid' })
  await expect(grid).toHaveAttribute('aria-checked', 'false')
  const box = (await grid.boundingBox())!
  // Click the "Off" half while it's off: still turns on.
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2)
  await expect(grid).toHaveAttribute('aria-checked', 'true')
  // Click the "On" half while it's on: turns off.
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2)
  await expect(grid).toHaveAttribute('aria-checked', 'false')
  await grid.focus()
  await page.keyboard.press('Space')
  await expect(grid).toHaveAttribute('aria-checked', 'true')
})
