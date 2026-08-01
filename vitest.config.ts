import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: false,
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: [
              'tests/unit/domain/**/*.test.ts',
              'tests/unit/shared/**/*.test.ts',
              'tests/unit/workers/**/*.test.ts',
              'tests/unit/scripts/**/*.test.ts',
              // Neon 実接続の結合テスト（CIVILDRAFT_TEST_NEON_CONNECTION 未設定時は skip）
              'tests/integration/workers/**/*.test.ts',
            ],
          },
        },
        {
          extends: true,
          test: {
            name: 'jsdom',
            environment: 'jsdom',
            setupFiles: ['tests/setup.ts'],
            include: [
              'tests/unit/app/**/*.test.ts',
              'tests/unit/app/**/*.test.tsx',
              'tests/unit/infrastructure/**/*.test.ts',
              'tests/integration/**/*.test.ts',
            ],
            exclude: ['tests/integration/workers/**'],
          },
        },
      ],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.d.ts', 'src/main.tsx'],
      },
    },
  }),
)
