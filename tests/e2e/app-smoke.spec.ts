import { expect, test } from '@playwright/test'

test('ホームから新規案件作成、CAD編集、監査ログHTML出力まで操作できる', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('ホーム・案件一覧').first()).toBeVisible()

  await page.getByRole('button', { name: '＋ 新規案件・図面' }).click()
  await page.getByLabel('案件名').fill('E2E施工ヤード')
  await page.getByLabel('初期図面名').fill('E2E施工ヤード図')
  await page.getByRole('button', { name: '案件と図面を作成' }).click()
  await expect(page.getByText('案件詳細: E2E施工ヤード')).toBeVisible()

  await page.getByRole('button', { name: '✏️ 作図編集' }).click()
  await expect(page.getByRole('button', { name: '共有保存' })).toBeVisible()
  await expect(page.getByRole('button', { name: '共有再読込' })).toBeVisible()

  await page.getByRole('button', { name: /監査ログ/ }).click()
  await expect(page.getByText('保存、承認、出力、認証イベントの記録')).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'HTMLエクスポート' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('civildraft-audit-log.html')
  await expect(page.getByText('HTMLエクスポートを作成しました')).toBeVisible()
})

test('照査・承認ワークフローをブラウザ上で承認済みまで進められる', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /照査・承認/ }).click()

  await expect(page.getByText('改訂の照査依頼・照査・承認・差戻し・廃止')).toBeVisible()
  await page.getByRole('button', { name: '照査依頼' }).click()
  await expect(page.getByText('照査中（inReview）')).toBeVisible()

  await page.getByRole('button', { name: '監督員（supervisor）' }).click()
  await page.getByRole('button', { name: '照査', exact: true }).click()
  await expect(page.getByText('承認待ち（pendingApproval）')).toBeVisible()

  await page.getByRole('button', { name: '承認', exact: true }).click()
  await expect(page.getByText('承認済み（approved）')).toBeVisible()
  await expect(page.getByText('凍結（承認済み/廃止は内容変更不可・§19.2）')).toBeVisible()
})
