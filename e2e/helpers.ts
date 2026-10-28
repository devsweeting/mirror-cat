import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export interface Launched {
  app: ElectronApplication
  page: Page
  userData: string
  /** Console errors and CSP violations seen in the editor window. */
  problems: string[]
  close(): Promise<void>
}

/**
 * Launch the built app (out/) against a throwaway data folder, with the
 * projector opening as a small window instead of fullscreen. Pass `scene`
 * to start from a saved scene.json, and `env` for extra variables (e.g.
 * the MIRRORCAT_AI_* test hooks).
 */
export async function launchApp({
  scene,
  env
}: { scene?: unknown; env?: Record<string, string> } = {}): Promise<Launched> {
  const userData = await mkdtemp(join(tmpdir(), 'mirrorcat-e2e-'))
  if (scene) await writeFile(join(userData, 'scene.json'), JSON.stringify(scene))

  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      MIRRORCAT_USER_DATA: userData,
      MIRRORCAT_OUTPUT_WINDOWED: '1',
      NODE_ENV: 'production',
      ...env
    }
  })
  const page = await app.firstWindow()
  const problems: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /Content.Security.Policy|Refused to/i.test(msg.text())) {
      problems.push(msg.text())
    }
  })
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByText('Mirror Cat')).toBeVisible()

  return {
    app,
    page,
    userData,
    problems,
    async close() {
      await app.close().catch(() => undefined)
      await rm(userData, { recursive: true, force: true })
    }
  }
}

export function windowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
}

/** Click an application-menu item by label, as if chosen from the menu bar. */
export async function clickMenuItem(app: ElectronApplication, label: string): Promise<void> {
  const found = await app.evaluate(({ Menu }, wanted) => {
    type Item = Electron.MenuItem
    const find = (items: Item[]): Item | undefined => {
      for (const item of items) {
        if (item.label === wanted && item.visible) return item
        const inner = item.submenu ? find(item.submenu.items) : undefined
        if (inner) return inner
      }
      return undefined
    }
    const item = find(Menu.getApplicationMenu()?.items ?? [])
    item?.click()
    return !!item
  }, label)
  expect(found, `menu item "${label}"`).toBe(true)
}

/**
 * Go live on whatever display is selected. If that's the laptop's own
 * screen, confirm the "cover this screen" prompt. Returns the projector
 * window's page.
 */
export async function goLive({ app, page }: Pick<Launched, 'app' | 'page'>): Promise<Page> {
  const opened = app.waitForEvent('window')
  await page.getByRole('button', { name: 'Go live' }).click()
  const confirm = page.getByRole('button', { name: 'Cover this screen' })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  const output = await opened
  await output.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: 'Stop projecting' })).toBeVisible()
  return output
}

/** A small PNG made in the page, imported as a generated image. Returns its asset id. */
export function importTestImage(page: Page, name: string): Promise<string> {
  return page.evaluate(async (assetName) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 32
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = `hsl(${Math.random() * 360}, 70%, 50%)`
    ctx.fillRect(0, 0, 64, 32)
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png')
    )
    const asset = await window.mirrorcat.media.importGenerated({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      name: assetName
    })
    return asset.id
  }, name)
}

/** Drag a stage handle by an offset in pixels, with intermediate moves like a real drag. */
export async function dragBy(page: Page, label: string, dx: number, dy: number): Promise<void> {
  const box = (await page.getByLabel(label).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 })
  await page.mouse.move(x + dx, y + dy, { steps: 5 })
  await page.mouse.up()
}

export function cssLeft(page: Page, label: string): Promise<string> {
  return page.getByLabel(label).evaluate((el) => (el as HTMLElement).style.left)
}
