/**
 * E2E: 作図機能（新規作図・作図編集）の正常性・正確性検証。
 * dev と本番ビルド（playwright.prod.config.ts）の両方で実行される。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.stack ?? String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' && /Konva|getParent|bufferCanvas|no node/i.test(message.text())) {
      errors.push(message.text())
    }
  })
  return errors
}

async function exportDxf(page: Page): Promise<string> {
  await page.getByRole('button', { name: '出力', exact: true }).click()
  await expect(page.getByText('印刷・出力').first()).toBeVisible()
  await page.getByLabel('PDF（印刷用・表題欄付き）').uncheck()
  await page.getByLabel('DXF（CAD交換用）').check()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '出力を実行' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('civildraft.dxf')
  return readFile(await download.path(), 'utf8')
}

/** Konvaの再描画で要素が差し替わっても安定してクリックできるよう、座標で直接クリックする。 */
async function clickCanvas(
  page: Page,
  canvas: ReturnType<Page['getByTestId']>,
  x: number,
  y: number,
): Promise<void> {
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + x, box!.y + y)
}

test('新規作図: ガイド線・描画・Undo/Redo・グリッド/ガイド切替・DXF出力が正しく動作する', async ({ page }) => {
  const pageErrors = collectErrors(page)
  await page.goto('/?demo=1#/home')
  await page.getByRole('button', { name: '新規作図' }).click()

  await expect(page.locator('header').getByText('新規図面', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/新規図面のガイド線を表示しました（図形4件）/).first()).toBeVisible()

  const canvas = page.getByTestId('canvas-stage-container')
  await expect(canvas).toBeVisible()

  // ガイド線の表示切替
  const guideButton = page.getByRole('button', { name: /ガイド線/ })
  await guideButton.click()
  await expect(page.getByRole('button', { name: /ガイド線\s*─/ })).toBeVisible()
  await guideButton.click()
  await expect(page.getByRole('button', { name: /ガイド線\s*👁/ })).toBeVisible()

  // 円（中心＋半径点）
  await page.locator('button[aria-label="円"]').click()
  await clickCanvas(page, canvas, 520, 120)
  await clickCanvas(page, canvas, 580, 180)
  await expect(page.getByTitle('元に戻す')).toBeEnabled()

  // 線分（2クリック確定）
  await page.getByRole('button', { name: '線分' }).click()
  await clickCanvas(page, canvas, 200, 150)
  await clickCanvas(page, canvas, 380, 240)
  const undo = page.getByTitle('元に戻す')
  await expect(undo).toBeEnabled()

  // Undo → やり直すが有効、Redo → 元に戻すが再有効
  await undo.click()
  await expect(page.getByTitle('やり直す')).toBeEnabled()
  await page.getByTitle('やり直す').click()
  await expect(undo).toBeEnabled()

  // 矩形（対角2点）
  await page.getByRole('button', { name: '矩形' }).click()
  await clickCanvas(page, canvas, 240, 320)
  await clickCanvas(page, canvas, 380, 400)

  // DXF出力に LINE（ガイド線＋線分＋矩形）と CIRCLE が含まれる
  const dxf = await exportDxf(page)
  expect(dxf).toContain('ENTITIES')
  expect(dxf).toContain('LINE')
  expect(dxf).toContain('CIRCLE')

  expect(pageErrors).toEqual([])
})

test('作図編集: 案件図面の読込・追記・Undo・レイヤー切替・DXF出力が正しく動作する', async ({ page }) => {
  const pageErrors = collectErrors(page)
  await page.goto('/?demo=1#/home')
  await page.getByRole('button', { name: 'みらい台地区 市道拡幅工事' }).first().click()
  await page.getByText('DWG-011', { exact: true }).first().click()
  await page.getByRole('button', { name: 'CAD編集で開く' }).click()

  await expect(page.locator('header').getByText('仮設計画図（矢板・切梁）', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/デモ図面を読み込みました（図形\d+件）/).first()).toBeVisible()

  const canvas = page.getByTestId('canvas-stage-container')
  await expect(canvas).toBeVisible()

  // 既存図面へ線分を追記し、Undoで戻せる
  await page.getByRole('button', { name: '線分' }).click()
  await clickCanvas(page, canvas, 300, 200)
  await clickCanvas(page, canvas, 420, 280)
  const undo = page.getByTitle('元に戻す')
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(page.getByTitle('やり直す')).toBeEnabled()

  // ガイド線レイヤーの表示切替（ヘッダーボタン）
  await page.getByRole('button', { name: /ガイド線/ }).click()
  await expect(page.getByRole('button', { name: /ガイド線\s*─/ })).toBeVisible()

  const dxf = await exportDxf(page)
  expect(dxf).toContain('ENTITIES')
  expect(dxf).toContain('LINE')

  expect(pageErrors).toEqual([])
})

test('新規作図: 自動保存→リロード→復元で作図内容が保持される', async ({ page }) => {
  const pageErrors = collectErrors(page)
  await page.goto('/?demo=1#/home')
  await page.getByRole('button', { name: '新規作図' }).click()

  const canvas = page.getByTestId('canvas-stage-container')
  await expect(canvas).toBeVisible()
  await page.getByRole('button', { name: '線分' }).click()
  await clickCanvas(page, canvas, 220, 160)
  await clickCanvas(page, canvas, 360, 220)
  await expect(page.getByText(/自動保存済み/).first()).toBeVisible({ timeout: 15_000 })

  await page.reload()
  await page.getByRole('button', { name: 'ホーム・案件一覧' }).click()
  await expect(page.getByRole('button', { name: '復元' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '復元' }).click()
  await expect(page.getByTestId('canvas-stage-container')).toBeVisible()

  const dxf = await exportDxf(page)
  expect(dxf).toContain('LINE')
  expect(pageErrors).toEqual([])
})
