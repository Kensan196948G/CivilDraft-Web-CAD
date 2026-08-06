import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: false,
      environment: 'node',
      include: ['tests/performance/**/*.test.ts'],
      testTimeout: 180_000,
      hookTimeout: 60_000,
    },
  }),
)
