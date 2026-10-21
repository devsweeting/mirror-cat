import { expect, test } from '@playwright/test'
import { goLive, launchApp, windowCount, type Launched } from './helpers'

// Each test leaves the app with the projector closed. The projector opens
// as a small window here (MIRRORCAT_OUTPUT_WINDOWED), never fullscreen.
let ctx: Launched

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.close()
})

test('Esc on the projector closes it and the editor leaves "Live"', async () => {
  await goLive(ctx)
  expect(await windowCount(ctx.app)).toBe(2)
  // Playwright's keyboard goes through the DevTools protocol, which skips
  // Electron's before-input-event; sendInputEvent takes the same path as
  // a real key press.
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const output = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('#'))
    output?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  })
  await expect.poll(() => windowCount(ctx.app)).toBe(1)
  await expect(ctx.page.getByRole('button', { name: 'Go live' })).toBeVisible()
})

test('Stop projecting closes the projector window', async () => {
  await goLive(ctx)
  await ctx.page.getByRole('button', { name: 'Stop projecting' }).click()
  await expect.poll(() => windowCount(ctx.app)).toBe(1)
})

test('unplugging the live display closes the projector', async () => {
  await goLive(ctx)
  const displayId = Number(await ctx.page.locator('.projector-select select').inputValue())
  await ctx.app.evaluate(({ screen }, id) => {
    // What Electron emits when a monitor is disconnected.
    screen.emit('display-removed', {}, { id })
  }, displayId)
  await expect.poll(() => windowCount(ctx.app)).toBe(1)
  await expect(ctx.page.getByRole('button', { name: 'Go live' })).toBeVisible()
})

test('going live on this screen asks first, and Cancel does nothing', async () => {
  const select = ctx.page.locator('.projector-select select')
  const primary = await select.evaluate((el) => {
    const option = [...(el as HTMLSelectElement).options].find((o) =>
      o.text.includes('(this screen)')
    )
    return option?.value ?? null
  })
  test.skip(primary === null, 'no primary display reported')
  const previous = await select.inputValue()
  await select.selectOption(primary!)
  await ctx.page.getByRole('button', { name: 'Go live' }).click()
  await expect(
    ctx.page.getByRole('alertdialog', { name: 'Project onto this screen?' })
  ).toBeVisible()
  await ctx.page.getByRole('button', { name: 'Cancel' }).click()
  await expect(ctx.page.getByRole('alertdialog')).toHaveCount(0)
  expect(await windowCount(ctx.app)).toBe(1)
  await select.selectOption(previous)
})

// Last: it closes the editor. macOS only, where the app stays running with
// no windows; elsewhere closing the last window quits by design.
test('closing the editor while live closes the projector; the dock reopens the editor', async () => {
  test.skip(process.platform !== 'darwin', 'macOS app lifecycle')
  await goLive(ctx)
  await ctx.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().includes('#'))
      ?.close()
  })
  await expect.poll(() => windowCount(ctx.app)).toBe(0)

  const reopened = ctx.app.waitForEvent('window')
  await ctx.app.evaluate(({ app }) => {
    app.emit('activate')
  })
  const editor = await reopened
  await expect(editor.getByRole('button', { name: 'Go live' })).toBeVisible()
  expect(await windowCount(ctx.app)).toBe(1)
})
