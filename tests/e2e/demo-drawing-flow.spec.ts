import { expect, test, type Page } from '@playwright/test'

/** ページ内の未処理エラーを収集し、テスト末尾で空であることを検証する。 */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.stack ?? String(error)))
  return errors
}

test('案件→図面選択→CAD編集で開く で案件のサンプル2D図形が読み込まれる', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await page.goto('/?demo=1#/home')
  await expect(page.getByText('ホーム・案件一覧').first()).toBeVisible()

  await page.getByRole('button', { name: 'みらい台地区 市道拡幅工事' }).first().click()
  await expect(page.getByRole('button', { name: 'すべて12' })).toBeVisible()

  await page.getByText('DWG-011', { exact: true }).first().click()
  await page.getByRole('button', { name: 'CAD編集で開く' }).click()

  await expect(page.locator('header').getByText('仮設計画図（矢板・切梁）', { exact: true }).first()).toBeVisible()
  await page.waitForTimeout(800)
  expect(pageErrors).toEqual([])
  await expect(page.getByTestId('canvas-stage-container')).toBeVisible()
})

test('CAD作図でガイド線が初期表示され、表示切替ができる', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await page.goto('/?demo=1#/home')
  await page.getByRole('button', { name: /^作図/ }).click()
  await page.getByRole('button', { name: /CAD作図/ }).click()

  await expect(page.locator('header').getByText('新規図面', { exact: true }).first()).toBeVisible()
  await page.waitForTimeout(800)
  expect(pageErrors).toEqual([])
  const guideButton = page.getByRole('button', { name: /ガイド線/ })
  await expect(guideButton).toBeVisible()
  await guideButton.click()
  await expect(page.getByRole('button', { name: /ガイド線\s*─/ })).toBeVisible()
})

test('CAD編集の左ツールパネルは折りたたみセクションで整理されている', async ({ page }) => {
  const pageErrors = collectPageErrors(page)
  await page.goto('/?demo=1#/home')
  await page.getByRole('button', { name: /^作図/ }).click()
  await page.getByRole('button', { name: /CAD編集/ }).click()

  await expect(page.getByRole('toolbar', { name: '作図ツール' })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: '編集ツール' })).toBeVisible()
  await expect(page.getByLabel('スナップ許容差px')).not.toBeVisible()
  await page.getByRole('button', { name: /^スナップ\s*›/ }).click()
  await expect(page.getByLabel('スナップ許容差px')).toBeVisible()
  await page.getByRole('button', { name: /^編集/ }).click()
  await expect(page.getByRole('toolbar', { name: '編集ツール' })).not.toBeVisible()
  expect(pageErrors).toEqual([])
})
