import { expect, test } from '@playwright/test'
import { importTestImage, launchApp, type Launched } from './helpers'

let ctx: Launched

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.close()
})

test('opens the editor', async () => {
  await expect(ctx.page.getByRole('button', { name: 'Go live' })).toBeVisible()
})

test('runs with the production security settings', async () => {
  const { app, page } = ctx
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(csp).toContain("default-src 'none'")

  const env = await page.evaluate(() => ({
    hasApi: typeof window.mirrorcat === 'object',
    hasImportFiles: typeof window.mirrorcat.media.importFiles === 'function',
    exposesPaths: 'getPathForFile' in window.mirrorcat || 'importPaths' in window.mirrorcat.media,
    hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
    hasProcess: typeof (window as unknown as { process?: unknown }).process !== 'undefined'
  }))
  expect(env).toEqual({
    hasApi: true,
    hasImportFiles: true,
    exposesPaths: false,
    hasRequire: false,
    hasProcess: false
  })

  // getLastWebPreferences exists at runtime but isn't in Electron's typings.
  type WithPrefs = { getLastWebPreferences(): { sandbox?: boolean } | null }
  const sandboxed = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map(
      (w) => (w.webContents as unknown as WithPrefs).getLastWebPreferences()?.sandbox
    )
  )
  expect(sandboxed.every(Boolean)).toBe(true)
})

test('imports a generated image and serves it over mirrorcat-media under the CSP', async () => {
  const { page } = ctx
  const id = await importTestImage(page, 'e2e')
  const width = await page.evaluate(
    (assetId) =>
      new Promise<number>((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img.naturalWidth)
        img.onerror = () => resolve(-1)
        img.src = `mirrorcat-media://asset/${assetId}`
      }),
    id
  )
  expect(width).toBe(64)
})

test('the stage draws with WebGL', async () => {
  await expect(ctx.page.locator('canvas.projection-gl').first()).toBeVisible()
})

test('a file made in page script cannot be imported by dropping it', async () => {
  const { page } = ctx
  const before = await page.evaluate(() => window.mirrorcat.media.list().then((l) => l.length))
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'fake.png'))
    const stage = document.querySelector('.stage')!
    for (const type of ['dragenter', 'dragover', 'drop']) {
      stage.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true })
      )
    }
  })
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => window.mirrorcat.media.list().then((l) => l.length))
  expect(after).toBe(before)
})

test('no console errors or CSP violations', async () => {
  await ctx.page.waitForTimeout(500)
  expect(ctx.problems).toEqual([])
})
