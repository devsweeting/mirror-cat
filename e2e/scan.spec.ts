import { expect, test } from '@playwright/test'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createSurface, type SceneState } from '../src/shared/types'
import { goLive, importTestImage, launchApp, type Launched } from './helpers'

function scene(): SceneState {
  return { surfaces: [createSurface('s-1', 'Vase')], outputDisplayId: null }
}

let launched: Launched

test.beforeAll(async () => {
  // CI machines may have no Wi-Fi; the dev-only override keeps the link local.
  launched = await launchApp({ scene: scene(), env: { MIRRORCAT_CAPTURE_HOST: '127.0.0.1' } })
})

test.afterAll(async () => {
  await launched?.close()
})

test('scan: the phone opens the link, sends a photo, and it goes on the surface', async () => {
  const { page, userData, problems } = launched
  await page.locator('.surface-header', { hasText: 'Vase' }).click()
  await page.getByRole('button', { name: 'Scan', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'Scan with your phone' })
  await expect(dialog.getByRole('img', { name: /QR code for http:\/\/127\.0\.0\.1:\d+\/c\// })).toBeVisible()
  await expect(dialog.getByRole('status')).toContainText('Waiting for your phone')
  await page.screenshot({ path: 'test-results/scan-waiting.png' })

  const alt = (await dialog.getByRole('img', { name: /QR code for/ }).getAttribute('alt'))!
  const url = alt.replace('QR code for ', '')

  // The phone opens the page.
  const html = await fetch(url).then((r) => r.text())
  expect(html).toContain('Cat’s camera')
  await expect(dialog.getByRole('status')).toContainText('Phone connected')

  // ...and sends a JPEG (made in the editor page, standing in for the camera).
  const jpeg = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 240
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#334'
    ctx.fillRect(0, 0, 320, 240)
    ctx.fillStyle = '#d96'
    ctx.beginPath()
    ctx.ellipse(160, 130, 50, 80, 0, 0, Math.PI * 2)
    ctx.fill()
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
  const sent = await fetch(`${url}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: new Uint8Array(jpeg)
  })
  expect(sent.status).toBe(200)

  const received = page.getByRole('dialog', { name: 'Photo received' })
  await expect(received.getByRole('img', { name: 'The photo from your phone' })).toBeVisible()
  await page.screenshot({ path: 'test-results/scan-received.png' })
  await received.getByRole('button', { name: 'Put on Vase' }).click()
  await expect(received).toHaveCount(0)

  await expect
    .poll(async () => JSON.parse(await readFile(join(userData, 'scene.json'), 'utf8')).surfaces[0].assetId)
    .toMatch(/^[a-f0-9]{64}$/)

  // Closing the dialog closes the link.
  await expect(fetch(url)).rejects.toThrow()
  expect(problems).toEqual([])
})

test('a non-image upload is refused and the dialog says why', async () => {
  const { page } = launched
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Scan with your phone' })
  const alt = (await dialog.getByRole('img', { name: /QR code for/ }).getAttribute('alt'))!
  const url = alt.replace('QR code for ', '')
  const sent = await fetch(`${url}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: new TextEncoder().encode('definitely not a jpeg')
  })
  expect(sent.status).toBe(422)
  await expect(dialog.getByRole('alert')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('live scan: the projector shows the frame, MirrorCat finds it, and the photo goes back on the wall', async () => {
  const run = await launchApp({ scene: scene(), env: { MIRRORCAT_CAPTURE_HOST: '127.0.0.1' } })
  try {
    const { page, app, userData } = run
    const output = await goLive({ app, page })
    await page.getByRole('button', { name: 'Scan', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Scan with your phone' })
    await expect(dialog).toContainText('fit the whole glowing frame')

    // The projector draws the scan pattern while the scan waits.
    const pattern = output.getByLabel('Scan pattern')
    await expect(pattern).toBeVisible()
    await output.waitForTimeout(200)
    const shot = await output.screenshot()

    const alt = (await dialog.getByRole('img', { name: /QR code for/ }).getAttribute('alt'))!
    const url = alt.replace('QR code for ', '')
    expect(await fetch(url).then((r) => r.text())).toContain('whole glowing frame')

    // A "photo" of the wall: the projector frame fills the middle 80% of it.
    const photo = await page.evaluate(async (png) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }))
      const c = document.createElement('canvas')
      c.width = 1500
      c.height = Math.round((1500 * bitmap.height) / bitmap.width)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(bitmap, c.width * 0.1, c.height * 0.1, c.width * 0.8, c.height * 0.8)
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92))
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    }, Array.from(shot))
    const sent = await fetch(`${url}/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array(photo)
    })
    expect(sent.status).toBe(200)

    const lineUp = page.getByRole('dialog', { name: 'Line up the photo' })
    await expect(lineUp.getByRole('status')).toContainText('Found the projector frame', { timeout: 10000 })
    // The pattern is gone once the photo is in.
    await expect(pattern).toHaveCount(0)

    // Corners land where the frame was put in the photo (10% / 90%).
    const left = async (name: string): Promise<number> =>
      parseFloat(await lineUp.getByRole('button', { name }).evaluate((el) => (el as HTMLElement).style.left))
    const top = async (name: string): Promise<number> =>
      parseFloat(await lineUp.getByRole('button', { name }).evaluate((el) => (el as HTMLElement).style.top))
    expect(Math.abs((await left('Projector frame top-left corner')) - 10)).toBeLessThan(1.5)
    expect(Math.abs((await top('Projector frame top-left corner')) - 10)).toBeLessThan(1.5)
    expect(Math.abs((await left('Projector frame bottom-right corner')) - 90)).toBeLessThan(1.5)
    expect(Math.abs((await top('Projector frame bottom-right corner')) - 90)).toBeLessThan(1.5)

    // Arrow keys nudge a corner.
    const tl = lineUp.getByRole('button', { name: 'Projector frame top-left corner' })
    const before = await left('Projector frame top-left corner')
    await tl.focus()
    await page.keyboard.press('Shift+ArrowRight')
    expect(await left('Projector frame top-left corner')).toBeCloseTo(before + 2, 1)
    await page.keyboard.press('Shift+ArrowLeft')
    await page.screenshot({ path: 'test-results/scan-line-up.png' })

    await lineUp.getByRole('button', { name: 'Continue' }).click()
    // Nothing but the wall and the pattern in this photo: no shapes to offer.
    const shapes = page.getByRole('dialog', { name: 'Pick the shapes' })
    await expect(shapes.getByRole('status')).toContainText('No shapes found yet', { timeout: 10000 })
    await shapes.getByRole('button', { name: 'Project the whole photo' }).click()
    await expect(shapes).toHaveCount(0)
    await expect(page.locator('.surface-header', { hasText: 'Scan' })).toBeVisible()

    // The new surface fills the projector frame exactly, showing the photo
    // straightened to the frame -- nothing reaches past the projector's area.
    await expect
      .poll(async () => {
        const saved = JSON.parse(await readFile(join(userData, 'scene.json'), 'utf8'))
        return saved.surfaces.find((s: { name: string }) => s.name === 'Scan')?.corners
      })
      .toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ])
    // It shows the straightened copy, saved to the library next to the photo.
    const sceneNow = JSON.parse(await readFile(join(userData, 'scene.json'), 'utf8'))
    const scanSurface = sceneNow.surfaces.find((s: { name: string }) => s.name === 'Scan')
    const index = JSON.parse(await readFile(join(userData, 'media', 'library.json'), 'utf8'))
    const assets: { id: string; name: string }[] = index.assets ?? index
    expect(assets.find((a) => a.id === scanSurface.assetId)?.name).toMatch(/\(fit to projector\)$/)
    await expect(page.locator('.corner-handle.offstage')).toHaveCount(0)
    await output.waitForTimeout(300)
    await output.screenshot({ path: 'test-results/scan-projected.png' })
    expect(run.problems).toEqual([])
  } finally {
    await run.close()
  }
})

test('live scan: shapes in the photo become surfaces with their corners in place', async () => {
  const run = await launchApp({ scene: scene(), env: { MIRRORCAT_CAPTURE_HOST: '127.0.0.1' } })
  try {
    const { page, app, userData } = run
    const output = await goLive({ app, page })
    await page.getByRole('button', { name: 'Scan', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Scan with your phone' })
    const pattern = output.getByLabel('Scan pattern')
    await expect(pattern).toBeVisible()
    await output.waitForTimeout(200)
    const shot = await output.screenshot()
    const alt = (await dialog.getByRole('img', { name: /QR code for/ }).getAttribute('alt'))!
    const url = alt.replace('QR code for ', '')

    // The frame fills the middle 80% of the photo. On the wall: a dark
    // picture frame (a four-sided shape) and a round mirror (traced).
    const photo = await page.evaluate(async (png) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }))
      const c = document.createElement('canvas')
      c.width = 1500
      c.height = Math.round((1500 * bitmap.height) / bitmap.width)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(bitmap, c.width * 0.1, c.height * 0.1, c.width * 0.8, c.height * 0.8)
      ctx.fillStyle = '#2a2622'
      ctx.fillRect(c.width * 0.3, c.height * 0.35, c.width * 0.2, c.height * 0.3)
      ctx.fillStyle = '#d8dde0'
      ctx.beginPath()
      ctx.arc(c.width * 0.68, c.height * 0.5, c.height * 0.13, 0, Math.PI * 2)
      ctx.fill()
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92))
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    }, Array.from(shot))
    const sent = await fetch(`${url}/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array(photo)
    })
    expect(sent.status).toBe(200)

    const lineUp = page.getByRole('dialog', { name: 'Line up the photo' })
    await expect(lineUp.getByRole('status')).toContainText('Found the projector frame', { timeout: 10000 })
    await lineUp.getByRole('button', { name: 'Continue' }).click()

    const picker = page.getByRole('dialog', { name: 'Pick the shapes' })
    const rows = picker.getByRole('checkbox')
    await expect(rows).toHaveCount(2, { timeout: 10000 })
    await expect(rows.nth(0)).toContainText('Four corners')
    await expect(rows.nth(1)).toContainText('Traced outline')
    await page.screenshot({ path: 'test-results/scan-shapes.png' })

    // Unpick and re-pick from the list; send shape 1 onto the existing surface.
    await rows.nth(1).click()
    await expect(picker.getByRole('button', { name: 'Make 1 surface' })).toBeVisible()
    await rows.nth(1).click()
    await picker.getByLabel('Where shape 1 goes').selectOption({ label: 'Move Vase here' })
    await picker.getByRole('button', { name: 'Make 2 surfaces' }).click()
    await expect(picker).toHaveCount(0)

    const saved = async (): Promise<SceneState> =>
      JSON.parse(await readFile(join(userData, 'scene.json'), 'utf8'))
    // The frame: photo 30–50% across, 35–65% down → (p − 0.1) / 0.8 of the projector frame.
    await expect.poll(async () => (await saved()).surfaces.length).toBe(2)
    const now = await saved()
    const vase = now.surfaces.find((s) => s.name === 'Vase')!
    const expected = [
      { x: 0.25, y: 0.3125 },
      { x: 0.5, y: 0.3125 },
      { x: 0.5, y: 0.6875 },
      { x: 0.25, y: 0.6875 }
    ]
    vase.corners.forEach((c, i) => {
      expect(Math.abs(c.x - expected[i].x)).toBeLessThan(0.015)
      expect(Math.abs(c.y - expected[i].y)).toBeLessThan(0.015)
    })
    expect(vase.mask).toBeNull()
    // The mirror is a new surface, trimmed to its round shape by a mask.
    const mirror = now.surfaces.find((s) => s.name === 'Shape 2')!
    expect(mirror.mask).not.toBeNull()
    await output.waitForTimeout(300)
    await output.screenshot({ path: 'test-results/scan-shapes-projected.png' })
    expect(run.problems).toEqual([])
  } finally {
    await run.close()
  }
})

test('a surface reaching past the frame offers to fit its image to the frame', async () => {
  const wide = {
    ...createSurface('s-wide', 'Wide'),
    corners: [
      { x: -0.125, y: -0.125 },
      { x: 1.125, y: -0.125 },
      { x: 1.125, y: 1.125 },
      { x: -0.125, y: 1.125 }
    ]
  }
  const run = await launchApp({ scene: { surfaces: [wide], outputDisplayId: null } })
  try {
    const { page, userData } = run
    await importTestImage(page, 'wide-photo')
    await page.locator('.topbar-library').click()
    const library = page.getByRole('complementary', { name: 'Media library' })
    await library.locator('.library-tile', { hasText: 'wide-photo' }).click()
    await library.getByRole('button', { name: 'Use on Wide' }).click()
    await page.locator('.topbar-library').click()

    await page.locator('.surface-header', { hasText: 'Wide' }).click()
    // Corners beyond the frame are pinned to the stage edge, not drawn off it.
    await expect(page.locator('.corner-handle.offstage')).toHaveCount(4)
    const note = page.locator('.surface-drawer').getByRole('status').filter({ hasText: 'reaches past' })
    await expect(note).toBeVisible()
    await page.screenshot({ path: 'test-results/fit-to-frame-before.png' })
    await note.getByRole('button', { name: 'Fit to the frame' }).click()
    await expect(note).toHaveCount(0)
    await expect(page.locator('.corner-handle.offstage')).toHaveCount(0)

    await expect
      .poll(async () => JSON.parse(await readFile(join(userData, 'scene.json'), 'utf8')).surfaces[0].corners)
      .toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ])
    await expect(page.getByText('wide-photo (fit to projector)').first()).toBeVisible()
    expect(run.problems).toEqual([])
  } finally {
    await run.close()
  }
})

const SAM_DIR = join(
  process.env.HOME ?? '',
  'Library',
  'Application Support',
  'mirrorcat',
  'models',
  'sam2.1-hiera-tiny'
)

/**
 * Go live, scan a "photo" of the projected pattern with a dark picture
 * frame running off the bottom of the frame (art inside it), line it up,
 * and continue to the shape picker.
 */
async function scanFramedPicture(
  run: Launched,
  scene: 'framed' | 'frame-and-mirror' = 'framed'
): Promise<import('@playwright/test').Locator> {
  const { page, app } = run
  const output = await goLive({ app, page })
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Scan with your phone' })
  await expect(output.getByLabel('Scan pattern')).toBeVisible()
  await output.waitForTimeout(200)
  const shot = await output.screenshot()
  const alt = (await dialog.getByRole('img', { name: /QR code for/ }).getAttribute('alt'))!
  const url = alt.replace('QR code for ', '')
  const photo = await page.evaluate(async ([png, layout]) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }))
    const c = document.createElement('canvas')
    c.width = 1500
    c.height = Math.round((1500 * bitmap.height) / bitmap.width)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(bitmap, c.width * 0.1, c.height * 0.1, c.width * 0.8, c.height * 0.8)
    if (layout === 'framed') {
      // The frame: photo 30–60% across, from 40% down past the projector frame's bottom (90%).
      ctx.fillStyle = '#231f24'
      ctx.fillRect(c.width * 0.3, c.height * 0.4, c.width * 0.3, c.height * 0.5)
      ctx.fillStyle = '#245a43'
      ctx.fillRect(c.width * 0.32, c.height * 0.43, c.width * 0.26, c.height * 0.47)
    } else {
      // A dark picture frame and a round mirror.
      ctx.fillStyle = '#2a2622'
      ctx.fillRect(c.width * 0.3, c.height * 0.35, c.width * 0.2, c.height * 0.3)
      ctx.fillStyle = '#d8dde0'
      ctx.beginPath()
      ctx.arc(c.width * 0.68, c.height * 0.5, c.height * 0.13, 0, Math.PI * 2)
      ctx.fill()
    }
    // Cover anything outside the projector frame again (the wall beyond it is dark).
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, c.height * 0.9, c.width, c.height * 0.1)
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }, [Array.from(shot), scene] as const)
  const sent = await fetch(`${url}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: new Uint8Array(photo)
  })
  expect(sent.status).toBe(200)
  const lineUp = page.getByRole('dialog', { name: 'Line up the photo' })
  await expect(lineUp.getByRole('status')).toContainText('Found the projector frame', { timeout: 10000 })
  await lineUp.getByRole('button', { name: 'Continue' }).click()
  const picker = page.getByRole('dialog', { name: 'Pick the shapes' })
  await expect(picker.getByRole('status').first()).not.toContainText('Looking for shapes', { timeout: 10000 })
  return picker
}

/** Drag a box on the shape stage, in 0..1 of the fitted photo. */
async function dragBox(
  picker: import('@playwright/test').Locator,
  box: { x0: number; y0: number; x1: number; y1: number }
): Promise<void> {
  const stage = picker.getByTestId('shape-stage')
  const r = (await stage.boundingBox())!
  const page = stage.page()
  await page.mouse.move(r.x + box.x0 * r.width, r.y + box.y0 * r.height)
  await page.mouse.down()
  await page.mouse.move(r.x + ((box.x0 + box.x1) / 2) * r.width, r.y + ((box.y0 + box.y1) / 2) * r.height, { steps: 4 })
  await page.mouse.move(r.x + box.x1 * r.width, r.y + box.y1 * r.height, { steps: 4 })
  await page.mouse.up()
}

/** The frame in the projector frame: (photo − 0.1) / 0.8, running to the bottom. */
const FRAME = [
  { x: 0.25, y: 0.375 },
  { x: 0.625, y: 0.375 },
  { x: 0.625, y: 1 },
  { x: 0.25, y: 1 }
]

async function expectOneSurfaceOnFrame(run: Launched, tolerance: number): Promise<void> {
  const saved = async (): Promise<SceneState> => JSON.parse(await readFile(join(run.userData, 'scene.json'), 'utf8'))
  await expect.poll(async () => (await saved()).surfaces.length).toBe(2)
  const shape = (await saved()).surfaces.find((s) => s.name.startsWith('Shape'))!
  shape.corners.forEach((c, i) => {
    expect(Math.abs(c.x - FRAME[i].x)).toBeLessThan(tolerance)
    expect(Math.abs(c.y - FRAME[i].y)).toBeLessThan(tolerance)
  })
}

test('a box around a frame picks the frame, not the art inside it', async () => {
  const run = await launchApp({ scene: scene(), env: { MIRRORCAT_CAPTURE_HOST: '127.0.0.1', MIRRORCAT_SAM_DIR: '/nonexistent' } })
  try {
    const picker = await scanFramedPicture(run)
    // The detailed finder isn't installed here: it offers the download.
    await expect(picker.getByRole('button', { name: /Download \(\d+ MB\)/ })).toBeVisible()
    const pickNone = picker.getByRole('button', { name: 'Pick no shapes' })
    if (await pickNone.isVisible()) await pickNone.click()
    await dragBox(picker, { x0: 0.23, y0: 0.35, x1: 0.645, y1: 0.995 })
    await expect(picker.getByRole('button', { name: 'Make 1 surface' })).toBeVisible()
    await run.page.screenshot({ path: 'test-results/scan-box.png' })
    await picker.getByRole('button', { name: 'Make 1 surface' }).click()
    await expectOneSurfaceOnFrame(run, 0.015)
    expect(run.problems).toEqual([])
  } finally {
    await run.close()
  }
})

test('the detailed finder (SAM 2) finds more shapes and answers boxes', async () => {
  test.skip(!existsSync(SAM_DIR), 'SAM 2 model not downloaded on this machine')
  test.setTimeout(90_000)
  const run = await launchApp({ scene: scene(), env: { MIRRORCAT_CAPTURE_HOST: '127.0.0.1', MIRRORCAT_SAM_DIR: SAM_DIR } })
  try {
    const picker = await scanFramedPicture(run)
    await picker.getByRole('button', { name: 'Find more shapes' }).click()
    await expect(picker.getByRole('status').filter({ hasText: /more\. Click|Nothing new/ })).toBeVisible({ timeout: 60000 })
    await picker.getByRole('button', { name: 'Pick no shapes' }).click()
    await dragBox(picker, { x0: 0.23, y0: 0.35, x1: 0.645, y1: 0.995 })
    await expect(picker.getByRole('button', { name: 'Make 1 surface' })).toBeVisible({ timeout: 30000 })
    await run.page.screenshot({ path: 'test-results/scan-sam.png' })
    await picker.getByRole('button', { name: 'Make 1 surface' }).click()
    await expectOneSurfaceOnFrame(run, 0.03)
    expect(run.problems).toEqual([])
  } finally {
    await run.close()
  }
})

test('combine, remove and undo, by mouse and by keyboard', async () => {
  const run = await launchApp({ scene: scene(), env: { MIRRORCAT_CAPTURE_HOST: '127.0.0.1', MIRRORCAT_SAM_DIR: '/nonexistent' } })
  try {
    const picker = await scanFramedPicture(run, 'frame-and-mirror')
    const { page } = run
    const rows = picker.getByRole('checkbox')
    await expect(rows).toHaveCount(2)
    const count = 2

    // Keyboard: pick none, then 1 and 2.
    await picker.getByTestId('shape-stage').hover()
    await page.keyboard.press('ControlOrMeta+D')
    await expect(picker.getByText(`0 of ${count} picked`)).toBeVisible()
    await page.keyboard.press('1')
    await page.keyboard.press('2')
    const bar = picker.locator('.selection-bar')
    await expect(bar).toContainText('2 picked')

    // The tooltip on Combine shows its key.
    await bar.getByRole('button', { name: 'Combine picked shapes' }).hover()
    await expect(page.getByRole('tooltip')).toContainText('Combine into one shape')
    await expect(page.getByRole('tooltip').locator('kbd')).toHaveText('C')
    await page.screenshot({ path: 'test-results/scan-combine-tooltip.png' })

    await page.keyboard.press('c')
    await expect(rows).toHaveCount(count - 1)
    await expect(bar).toContainText('1 picked')

    // Undo brings both back.
    await bar.getByRole('button', { name: 'Undo' }).click()
    await expect(rows).toHaveCount(count)

    // Remove with the key; undo with the shortcut.
    await page.keyboard.press('ControlOrMeta+D')
    await page.keyboard.press('1')
    await page.keyboard.press('Backspace')
    await expect(rows).toHaveCount(count - 1)
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(rows).toHaveCount(count)

    // The shortcuts list.
    await page.keyboard.press('?')
    await expect(picker.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Combine picked shapes')
    await page.screenshot({ path: 'test-results/scan-shortcuts.png' })
    await page.keyboard.press('Escape')
    await expect(picker.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)
    // That Esc closed only the list, not the scan.
    await expect(picker).toBeVisible()
    expect(run.problems).toEqual([])
  } finally {
    await run.close()
  }
})
