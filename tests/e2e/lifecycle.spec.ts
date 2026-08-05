/**
 * E2E: 作成 → 作図 → 自動保存 → 復元 → 再編集 → 出力 のライフサイクル（Issue #45）。
 *
 * 保存/再読込はローカル自動保存（IndexedDB）経路を使用する。
 * 共有保存（Cloud API）・改訂フローは Cloudflare Access Secret 設定（人間決裁）後に
 * 別スペックとして拡張する。DXF取込 UI は Issue #118（UI配線）後に追加する。
 */
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('作成→作図→自動保存→復元→DXF/PDF出力の一連フロー', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('ホーム・案件一覧').first()).toBeVisible()

  // 新規案件・図面を作成して CAD 編集を開く
  await page.getByRole('button', { name: '＋ 新規案件・図面' }).click()
  await page.getByLabel('案件名').fill('E2Eライフサイクル')
  await page.getByLabel('初期図面名').fill('E2Eライフサイクル図')
  await page.getByRole('button', { name: '案件と図面を作成' }).click()
  await expect(page.getByText('案件詳細: E2Eライフサイクル')).toBeVisible()

  await page.getByRole('button', { name: /^作図/ }).click()
  await page.getByRole('button', { name: '✏️ CAD編集' }).click()
  await expect(page.getByRole('button', { name: '共有保存' })).toBeVisible()

  // 線分ツールで図形を1つ描画（2クリックで確定）
  await page.getByRole('button', { name: '線分' }).click()
  const canvas = page.getByTestId('canvas-stage-container')
  await expect(canvas).toBeVisible()
  await canvas.click({ position: { x: 180, y: 160 } })
  await canvas.click({ position: { x: 320, y: 220 } })
  await expect(page.getByTitle('元に戻す')).toBeEnabled()

  // 出力画面へ移動（エディタがアンマウントされ、自動保存が flush される）
  await page.getByRole('button', { name: '出力', exact: true }).click()
  await expect(page.getByText('印刷・出力').first()).toBeVisible()

  // PDF / DXF のゴールデン出力（ファイル名・マジックバイト・構造を検証）
  await page.getByLabel('PDF（印刷用・表題欄付き）').check()
  await page.getByLabel('DXF（CAD交換用）').check()
  const pdfDownloadEvent = page.waitForEvent('download')
  const dxfDownloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '出力を実行' }).click()
  const downloads = await Promise.all([pdfDownloadEvent, dxfDownloadEvent])
  const pdf = downloads.find((d) => d.suggestedFilename() === 'civildraft.pdf')
  const dxf = downloads.find((d) => d.suggestedFilename() === 'civildraft.dxf')
  expect(pdf, 'PDF出力ファイルが生成される').toBeDefined()
  expect(dxf, 'DXF出力ファイルが生成される').toBeDefined()

  const pdfBytes = await readFile(await pdf!.path())
  const dxfText = await readFile(await dxf!.path(), 'utf8')
  expect(pdfBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  expect(dxfText).toContain('ENTITIES')
  expect(dxfText).toContain('LINE')
  await expect(page.getByText(/出力完了: PDF✓/)).toBeVisible()

  // 再読込 → 自動保存から復元 → 図形が保持されていることを DXF 再出力で確認
  await page.reload()
  await expect(page.getByText('ホーム・案件一覧').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '復元' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '復元' }).click()
  await expect(page.getByRole('button', { name: '共有保存' })).toBeVisible()
  await expect(page.getByTestId('canvas-stage-container')).toBeVisible()

  await page.getByRole('button', { name: '出力', exact: true }).click()
  await page.getByLabel('PDF（印刷用・表題欄付き）').uncheck()
  await page.getByLabel('DXF（CAD交換用）').check()
  const restoredDxfEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '出力を実行' }).click()
  const restoredDxf = await restoredDxfEvent
  expect(restoredDxf.suggestedFilename()).toBe('civildraft.dxf')
  const restoredText = await readFile(await restoredDxf.path(), 'utf8')
  expect(restoredText).toContain('LINE')
})
