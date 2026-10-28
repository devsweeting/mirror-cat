import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { launchApp, type Launched } from './helpers'

// Settings › AI & animation, with the dev-only hooks so nothing touches the
// real Keychain or a provider: keys are "encrypted" by a stand-in and the
// key check gives a canned answer.
const KEY = 'luma-api-e2e0123456789abcd4f2a'

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

function lumaCard(page: Page) {
  return page.locator('.provider-card[data-provider="luma"]')
}

let launched: Launched | null = null

test.afterEach(async () => {
  await launched?.close()
  launched = null
})

test('a good key is saved encrypted and only its last four come back', async () => {
  launched = await launchApp({
    env: { MIRRORCAT_AI_FAKE_CRYPTO: '1', MIRRORCAT_AI_KEYCHECK: 'accept' }
  })
  const { page, userData } = launched
  const dialog = await openSettings(page)
  const card = lumaCard(page)
  await expect(card.getByText('Not connected')).toBeVisible()

  await card.getByLabel('Luma API key').fill(KEY)
  await card.getByRole('button', { name: 'Save and check' }).click()
  await expect(card.getByText('Connected')).toBeVisible()
  await expect(card.getByText('…4f2a')).toBeVisible()
  await expect(card.getByLabel('Luma API key')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/settings-ai.png' })

  // What the page can see: statuses, never the key.
  const state = await page.evaluate(() => window.mirrorcat.ai.getState())
  expect(JSON.stringify(state)).not.toContain(KEY)
  expect(state.providers.find((p) => p.id === 'luma')).toMatchObject({
    connected: true,
    last4: '4f2a',
    check: 'ok'
  })
  // And on disk: no plain key.
  const file = await readFile(join(userData, 'ai-keys.json'), 'utf8')
  expect(file).not.toContain(KEY)

  await card.getByRole('button', { name: 'Remove' }).click()
  await expect(card.getByText('Not connected')).toBeVisible()
  await expect(card.getByLabel('Luma API key')).toBeFocused()

  // Escape closes, and focus goes back to the gear.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused()
})

test('a rejected key is not saved and says why', async () => {
  launched = await launchApp({
    env: { MIRRORCAT_AI_FAKE_CRYPTO: '1', MIRRORCAT_AI_KEYCHECK: 'reject' }
  })
  const { page } = launched
  await openSettings(page)
  const card = lumaCard(page)
  await card.getByLabel('Luma API key').fill(KEY)
  await card.getByRole('button', { name: 'Save and check' }).click()
  await expect(card.getByRole('alert')).toContainText('didn’t accept that key')
  await expect(card.getByRole('alert')).toContainText('luma-api-')
  await expect(card.getByText('Not connected')).toBeVisible()
  const state = await page.evaluate(() => window.mirrorcat.ai.getState())
  expect(state.providers.every((p) => !p.connected)).toBe(true)
})

test('offline: the key is kept, marked not checked yet', async () => {
  launched = await launchApp({
    env: { MIRRORCAT_AI_FAKE_CRYPTO: '1', MIRRORCAT_AI_KEYCHECK: 'offline' }
  })
  const { page } = launched
  await openSettings(page)
  const card = page.locator('.provider-card[data-provider="fal"]')
  await card.getByLabel('fal.ai API key').fill('abcd1234-ef56:7890abcdef')
  await card.getByRole('button', { name: 'Save and check' }).click()
  await expect(card.getByText('Saved', { exact: true })).toBeVisible()
  await expect(card.getByText(/couldn’t reach fal\.ai/)).toBeVisible()
})

test('animation defaults update the estimate and are saved', async () => {
  launched = await launchApp({ env: { MIRRORCAT_AI_FAKE_CRYPTO: '1' } })
  const { page, userData } = launched
  const dialog = await openSettings(page)
  await expect(dialog.getByText('about $0.30 with Luma')).toBeVisible()
  await dialog
    .getByRole('radiogroup', { name: 'Loop length' })
    .getByRole('radio', { name: '10 s' })
    .click()
  await expect(dialog.getByText('about $0.90 with Luma')).toBeVisible()

  const cap = dialog.getByLabel('Ask before spending more than')
  await cap.fill('2.5')
  await cap.press('Enter')
  await expect(cap).toHaveValue('2.50')

  await expect
    .poll(async () => JSON.parse(await readFile(join(userData, 'ai-settings.json'), 'utf8')))
    .toMatchObject({ loopSeconds: 10, askAboveUsd: 2.5 })

  await dialog.getByLabel('Model').selectOption('fal/seedance-2.0')
  await expect(dialog.getByText('Connect fal.ai above to use this model.')).toBeVisible()
  await expect(dialog.getByText(/fal\.ai quotes a price for each one/)).toBeVisible()
})
