import { expect, test, type Page } from '@playwright/test'
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
    surfaces: [{ ...createSurface('s-1', 'Box'), corners: CORNERS }],
    outputDisplayId: null
  }
}

async function savedMask(userData: string): Promise<Record<string, unknown> | null> {
  const saved = JSON.parse(await readFile(join(userData, 'scene.json'), 'utf8'))
  return saved.surfaces[0].mask
}

/** A PNG made in the page: an opaque circle on a transparent background. */
function cutoutPng(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 200
    c.height = 120
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#c33'
    ctx.beginPath()
    ctx.arc(100, 60, 50, 0, Math.PI * 2)
    ctx.fill()
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
}

let launched: Launched

test.beforeAll(async () => {
  launched = await launchApp({ scene: scene() })
})

test.afterAll(async () => {
  await launched?.close()
})

test('outline an object, touch it up with the brush, tune and remove the mask', async () => {
  const { page, userData, problems } = launched
  await page.locator('.surface-header', { hasText: 'Box' }).click()
  const drawer = page.locator('.surface-drawer')
  await expect(drawer.getByRole('button', { name: 'Edit the mask on the stage' })).toContainText(
    'Mask this surface'
  )

  await drawer.getByRole('button', { name: 'Edit the mask on the stage' }).click()
  const bar = page.getByRole('toolbar', { name: 'Editing the mask on Box' })
  await expect(bar).toBeVisible()
  // The prompt bar steps aside (same slot), and handles hide for the tools.
  await expect(page.getByPlaceholder('What should Cat paint?')).toHaveCount(0)
  await expect(page.getByLabel('Box top-left corner')).toHaveCount(0)
  await expect(bar.getByRole('radio', { name: 'Outline' })).toHaveAttribute('aria-checked', 'true')

  // Outline a box in the middle of the surface; click the first point to close.
  const layer = page.getByTestId('mask-paint-layer')
  const box = (await layer.boundingBox())!
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const
  const points = [at(0.4, 0.4), at(0.6, 0.42), at(0.6, 0.6), at(0.4, 0.58)]
  for (const [x, y] of points) await page.mouse.click(x, y)
  await expect(page.locator('.mask-outline-point')).toHaveCount(4)
  await page.mouse.click(...points[0])
  await expect(page.locator('.mask-outline-point')).toHaveCount(0)
  await expect.poll(() => savedMask(userData), { timeout: 5000 }).not.toBeNull()
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'test-results/mask-outlined.png' })

  // Brush: darken a stripe through the lit box.
  await bar.getByRole('radio', { name: 'Brush' }).click()
  await bar.getByRole('radio', { name: 'Dark' }).click()
  const firstId = (await savedMask(userData))!.id
  await page.mouse.move(...at(0.38, 0.5))
  await page.mouse.down()
  await page.mouse.move(...at(0.62, 0.5), { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => (await savedMask(userData))!.id).not.toBe(firstId)

  // Undo goes back one step (to the outlined mask).
  await bar.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await savedMask(userData))!.id).toBe(firstId)

  await bar.getByRole('button', { name: 'Done' }).click()
  await expect(bar).toHaveCount(0)
  await expect(page.getByPlaceholder('What should Cat paint?')).toBeVisible()
  await expect(page.getByLabel('Box top-left corner')).toBeVisible()
  await expect(drawer.locator('.mask-well img')).toBeVisible()
  expect(await readdir(join(userData, 'masks'))).toContain(`${firstId}.png`)

  // Edge softness in the drawer; invert in the options.
  await drawer.getByLabel('Edge softness').fill('4')
  await drawer.getByRole('button', { name: 'Mask options' }).click()
  const options = drawer.getByRole('dialog', { name: 'Mask options' })
  await options
    .getByRole('radiogroup', { name: 'Invert mask' })
    .getByRole('radio', { name: 'On' })
    .click()
  await expect.poll(() => savedMask(userData)).toMatchObject({ invert: true, feather: 0.04 })
  await page.keyboard.press('Escape')
  await expect(options).toHaveCount(0)
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'test-results/mask-inverted-soft.png' })

  await drawer.getByRole('button', { name: 'Mask options' }).click()
  await options.getByRole('button', { name: 'Remove mask' }).click()
  await expect(drawer.locator('.mask-well img')).toHaveCount(0)
  await expect.poll(() => savedMask(userData)).toBeNull()

  expect(problems).toEqual([])
})

test('M toggles mask mode; Esc cancels an outline first, then finishes', async () => {
  const { page } = launched
  await page.locator('.stage').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('m')
  const layer = page.getByTestId('mask-paint-layer')
  await expect(layer).toBeVisible()
  const box = (await layer.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await expect(page.locator('.mask-outline-point')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.mask-outline-point')).toHaveCount(0)
  await expect(layer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(layer).toHaveCount(0)
})

test('an image dropped on the mask well is saved and comes back after a relaunch', async () => {
  const first = await launchApp({ scene: scene() })
  let userData = first.userData
  try {
    const { page } = first
    await page.locator('.surface-header', { hasText: 'Box' }).click()
    const drawer = page.locator('.surface-drawer')
    const png = await cutoutPng(page)
    await page.locator('.mask-well').evaluate((well, bytes) => {
      const data = new DataTransfer()
      data.items.add(new File([new Uint8Array(bytes)], 'cutout.png', { type: 'image/png' }))
      well.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true }))
      well.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true }))
    }, png)
    await expect(drawer.locator('.mask-well img')).toBeVisible()
    await expect(drawer.getByRole('alert')).toHaveCount(0)
    await expect.poll(() => savedMask(userData)).not.toBeNull()
    const saved = (await savedMask(userData))!
    expect(first.problems).toEqual([])

    await first.app.close()
    const second = await launchApp({ userData })
    userData = second.userData
    try {
      await second.page.locator('.surface-header', { hasText: 'Box' }).click()
      await expect(second.page.locator('.surface-drawer .mask-well img')).toBeVisible()
      expect((await savedMask(userData))!.id).toBe(saved.id)
      expect(await readdir(join(userData, 'masks'))).toEqual([`${saved.id}.png`])
      expect(second.problems).toEqual([])
    } finally {
      await second.close()
    }
  } finally {
    await first.close()
  }
})

test('a cut-out image on the surface offers to light only the image', async () => {
  const run = await launchApp({ scene: scene() })
  try {
    const { page, userData } = run
    const png = await cutoutPng(page)
    await page.evaluate(
      (bytes) =>
        window.mirrorcat.media.importGenerated({ bytes: new Uint8Array(bytes), name: 'cutout' }),
      png
    )
    await page.locator('.topbar-library').click()
    const library = page.getByRole('complementary', { name: 'Media library' })
    await library.locator('.library-tile', { hasText: 'cutout' }).click()
    await library.getByRole('button', { name: 'Use on Box' }).click()

    await page.locator('.surface-header', { hasText: 'Box' }).click()
    const drawer = page.locator('.surface-drawer')
    const note = drawer.getByRole('note')
    await expect(note).toContainText('transparent background')
    await note.getByRole('button', { name: 'Light only the image' }).click()
    await expect(note).toHaveCount(0)
    await expect(drawer.locator('.mask-well img')).toBeVisible()
    await expect.poll(() => savedMask(userData)).not.toBeNull()
    await page.waitForTimeout(200)
    await page.screenshot({ path: 'test-results/mask-cutout.png' })
    expect(run.problems).toEqual([])
  } finally {
    await run.close()
  }
})
