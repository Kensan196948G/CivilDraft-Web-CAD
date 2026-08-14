import { defineConfig, devices } from '@playwright/test'

/**
 * 本番ビルド（vite build + preview）で図面表示導線を検証する構成。
 * dev サーバーでは再現しない tree-shaking / Konva ノード登録等の
 * 本番ビルド固有の問題を Browser E2E で検出する。
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/demo-drawing-flow.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5176',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
  projects: [
    {
      name: 'chromium-production',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
