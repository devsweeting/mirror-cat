import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let userData: string
const consoleProblems: string[] = []

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), 'mirrorcat-e2e-'))
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, MIRRORCAT_USER_DATA: userData, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /Content.Security.Policy|Refused to/i.test(msg.text())) {
      consoleProblems.push(msg.text())
    }
  })
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  await rm(userData, { recursive: true, force: true })
})

test('opens the editor', async () => {
  await expect(page.getByText('Mirror Cat')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Go live' })).toBeVisible()
})

test('runs with the production security settings', async () => {
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
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 32
    canvas.getContext('2d')!.fillRect(0, 0, 64, 32)
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png')
    )
    const asset = await window.mirrorcat.media.importGenerated({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      name: 'e2e'
    })
    const width = await new Promise<number>((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img.naturalWidth)
      img.onerror = () => resolve(-1)
      img.src = `mirrorcat-media://asset/${asset.id}`
    })
    return { kind: asset.kind, width }
  })
  expect(result).toEqual({ kind: 'image', width: 64 })
})

test('the stage draws with WebGL', async () => {
  await expect(page.locator('canvas.projection-gl').first()).toBeVisible()
})

test('no console errors or CSP violations', async () => {
  // Give late resource loads a moment to report.
  await page.waitForTimeout(500)
  expect(consoleProblems).toEqual([])
})
