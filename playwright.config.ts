import { defineConfig } from '@playwright/test'

// Drives the *built* app (out/) through Electron. Run with `npm run test:e2e`,
// which builds first. Each test gets a throwaway userData folder, so your
// real library and autosave are never touched.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  reporter: 'list'
})
