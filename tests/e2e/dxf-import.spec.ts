/**
 * E2E: DXF取込UI（Issue #118）。
 * エディタの「📥 取込」から .dxf を選択し、図面がキャンバスへ反映されることを検証する。
 */
import { expect, test } from '@playwright/test'

const LINE_DXF = [
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
  'ENDSEC',
  '0',
  'EOF',
].join('\n')

test('DXF取込ボタンからファイルを読み込み、図形がキャンバスへ反映される', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('ホーム・案件一覧').first()).toBeVisible()

  await page.getByRole('button', { name: '＋ 新規案件・図面' }).click()
  await page.getByLabel('案件名').fill('E2E-DXF取込')
  await page.getByLabel('初期図面名').fill('E2E-DXF取込図')
  await page.getByRole('button', { name: '案件と図面を作成' }).click()
  await expect(page.getByText('案件詳細: E2E-DXF取込')).toBeVisible()

  await page.getByRole('button', { name: '✏️ 作図編集' }).click()
  await expect(page.getByRole('button', { name: '共有保存' })).toBeVisible()

  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'sample.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(LINE_DXF, 'utf8'),
  })

  await expect(page.getByText(/DXF取込完了: 図形 1 件/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('canvas-stage-container')).toBeVisible()
})
