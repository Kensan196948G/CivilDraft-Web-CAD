import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: false,
      // 並列実行時に jsdom + 遅延ロードページのタイムアウト（5s）が不安定になるため
      // 15s へ拡張（2026-08-09 統合セッションで実測。CI でも同一設定を使用）。
      testTimeout: 15000,
      hookTimeout: 20000,
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
        // 2026-08-06 実測: stmts 91.52% / branch 83.51% / funcs 86.85% / lines 91.52%。
        // 閾値は実測より数%下に設定し、回帰防止と将来の改善余地を両立する。
        thresholds: {
          statements: 85,
          branches: 75,
          functions: 80,
          lines: 85,
        },
      },
    },
  }),
)
