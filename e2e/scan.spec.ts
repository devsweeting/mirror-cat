import { expect, test } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createSurface, type SceneState } from '../src/shared/types'
import { goLive, launchApp, type Launched } from './helpers'

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
  expect(html).toContain('Photo for MirrorCat')
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

    await lineUp.getByRole('button', { name: 'Project onto the wall' }).click()
    await expect(lineUp).toHaveCount(0)
    await expect(page.locator('.surface-header', { hasText: 'Scan' })).toBeVisible()

    // The new surface spreads the photo past the frame: its corners sit ~12.5% outside.
    await expect
      .poll(async () => {
        const saved = JSON.parse(await readFile(join(userData, 'scene.json'), 'utf8'))
        return saved.surfaces.find((s: { name: string }) => s.name === 'Scan')?.corners
      })
      .toBeTruthy()
    const saved = JSON.parse(await readFile(join(userData, 'scene.json'), 'utf8'))
    const corners = saved.surfaces.find((s: { name: string }) => s.name === 'Scan').corners
    expect(corners[0].x).toBeCloseTo(-0.125, 1)
    expect(corners[0].y).toBeCloseTo(-0.125, 1)
    expect(corners[2].x).toBeCloseTo(1.125, 1)
    expect(corners[2].y).toBeCloseTo(1.125, 1)
    await output.waitForTimeout(300)
    await output.screenshot({ path: 'test-results/scan-projected.png' })
    expect(run.problems).toEqual([])
  } finally {
    await run.close()
  }
})
