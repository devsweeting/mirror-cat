import { expect, test } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createSurface, type SceneState } from '../src/shared/types'
import { launchApp, type Launched } from './helpers'

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
