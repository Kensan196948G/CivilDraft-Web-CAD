/**
 * E2E: DXF取込 → 編集 → DXF/PDF出力のゴールデンフロー（Issue #45 受入基準）。
 * 取込UI（Issue #118 / PR #130）を前提とし、取込図形が出力へ引き継がれることと
 * 編集後の図面がDXF/PDFとして正しく出力されることを検証する。
 */
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const SAMPLE_DXF = [
  '0',
  'SECTION',
  '2',
  'ENTITIES',
  '0',
  'LINE',
  '8',
  '0',
  '10',
  '0.0',
  '20',
  '0.0',
  '11',
  '100.0',
  '21',
  '50.0',
  '0',
  'CIRCLE',
  '8',
  '0',
  '10',
  '200.0',
  '20',
  '150.0',
  '40',
  '40.0',
  '0',
  'ENDSEC',
  '0',
  'EOF',
].join('\n')

test('DXF取込→線分編集→DXF/PDF出力のゴールデンフロー', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('ホーム・案件一覧').first()).toBeVisible()

  await page.getByRole('button', { name: '＋ 新規案件・図面' }).click()
  await page.getByLabel('案件名').fill('E2E-DXFゴールデン')
  await page.getByLabel('初期図面名').fill('E2E-DXFゴールデン図')
  await page.getByRole('button', { name: '案件と図面を作成' }).click()
  await expect(page.getByText('案件詳細: E2E-DXFゴールデン')).toBeVisible()

  await page.getByRole('button', { name: /^作図/ }).click()
  await page.getByRole('button', { name: '✏️ 作図編集' }).click()
  await expect(page.getByRole('button', { name: '共有保存' })).toBeVisible()

  // 取込（LINE + CIRCLE の2図形）
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'golden.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(SAMPLE_DXF, 'utf8'),
  })
  await expect(page.getByText(/DXF取込完了: 図形 2 件/)).toBeVisible({ timeout: 15_000 })

  // 編集: 線分を1本追加（取込図形は残したまま）
  await page.getByRole('button', { name: '線分' }).click()
  const canvas = page.getByTestId('canvas-stage-container')
  await canvas.click({ position: { x: 180, y: 160 } })
  await canvas.click({ position: { x: 320, y: 220 } })
  await expect(page.getByTitle('元に戻す')).toBeEnabled()

  // 出力: DXFに取込図形（LINE/CIRCLE）と編集図形（LINE）が含まれる
  await page.getByRole('button', { name: '出力', exact: true }).click()
  await expect(page.getByText('印刷・出力').first()).toBeVisible()
  await page.getByLabel('PDF（印刷用・表題欄付き）').uncheck()
  await page.getByLabel('DXF（CAD交換用）').check()
  const dxfDownloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '出力を実行' }).click()
  const dxf = await dxfDownloadEvent
  expect(dxf.suggestedFilename()).toBe('civildraft.dxf')
  const dxfText = await readFile(await dxf.path(), 'utf8')
  expect(dxfText).toContain('LINE')
  expect(dxfText).toContain('CIRCLE')

  // 出力: PDF（%PDF- マジックバイト）
  await page.getByLabel('PDF（印刷用・表題欄付き）').check()
  await page.getByLabel('DXF（CAD交換用）').uncheck()
  const pdfDownloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '出力を実行' }).click()
  const pdf = await pdfDownloadEvent
  expect(pdf.suggestedFilename()).toBe('civildraft.pdf')
  const pdfBytes = await readFile(await pdf.path())
  expect(pdfBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
})
