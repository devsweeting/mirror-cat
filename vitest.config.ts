import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      // Logic worth covering. React components and the WebGL engine are
      // exercised by the end-to-end smoke test instead.
      include: [
        'src/shared/**/*.ts',
        'src/main/media/**/*.ts',
        'src/main/persistence/**/*.ts',
        'src/main/ipc/sceneValidation.ts',
        'src/renderer/src/state/sceneStore.ts',
        'src/renderer/src/state/shapeHistory.ts'
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        'src/main/media/protocol.ts',
        'src/shared/ipcChannels.ts'
      ],
      reporter: ['text', 'html']
    }
  }
})
