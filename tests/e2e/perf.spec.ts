/**
 * ブラウザ性能メトリクス（Issue #63）。
 *
 * 実測値は tests/performance/results/browser-metrics.json へ書き出し、
 * scripts/check-perf-thresholds.mjs が閾値超過を warning として報告する
 * （CI は fail させない。閾値の弱体化は ADR-0010 のレビュー運用で監視する）。
 *
 * 10,000図形描画は DXF取込 UI 配線（Issue #118）後に、同一エディタへ大量図形を
 * 読み込むシナリオとして追加する。現状は新規案件 → エディタ初回描画と
 * Undo/Redo 操作の実測を対象とする。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resultsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'performance', 'results')
const resultsPath = join(resultsDir, 'browser-metrics.json')

test('ホーム読込・エディタ初回描画・Undo/Redo操作の性能メトリクス', async ({ page }, testInfo) => {
  const metrics: Record<string, number> = {}

  const homeStart = Date.now()
  await page.goto('/')
  await expect(page.getByText('ホーム・案件一覧').first()).toBeVisible()
  metrics['browser.homeLoadMs'] = Date.now() - homeStart

  // 新規案件を作成してエディタを開く（lifecycle.spec.ts と同一の実績経路）
  await page.getByRole('button', { name: '＋ 新規案件・図面' }).click()
  await page.getByLabel('案件名').fill('E2E性能計測')
  await page.getByLabel('初期図面名').fill('E2E性能計測図')
  await page.getByRole('button', { name: '案件と図面を作成' }).click()
  await expect(page.getByText('案件詳細: E2E性能計測')).toBeVisible()
  await page.getByRole('button', { name: '✏️ 作図編集' }).click()

  const renderStart = Date.now()
  await expect(page.getByRole('button', { name: '共有保存' })).toBeVisible()
  await expect(page.getByTestId('canvas-stage-container')).toBeVisible()
  metrics['browser.editorInitialRenderMs'] = Date.now() - renderStart

  // 作図操作を2回行い、Undo/Redo を10サイクル実行して平均操作時間を計測
  await page.getByRole('button', { name: '線分' }).click()
  const canvas = page.getByTestId('canvas-stage-container')
  await canvas.click({ position: { x: 150, y: 140 } })
  await canvas.click({ position: { x: 220, y: 200 } })
  await canvas.click({ position: { x: 260, y: 150 } })
  await canvas.click({ position: { x: 330, y: 210 } })
  const undoButton = page.getByTitle('元に戻す')
  const redoButton = page.getByTitle('やり直す')
  await expect(undoButton).toBeEnabled()

  const cycles = 10
  const undoStart = Date.now()
  for (let i = 0; i < cycles; i++) {
    await undoButton.click()
    await redoButton.click()
  }
  metrics['browser.undoRedoCycleMs'] = (Date.now() - undoStart) / cycles

  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(resultsPath, JSON.stringify(metrics, null, 2))
  await testInfo.attach('browser-perf-metrics', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  })

  // 機能健全性のみ検証（性能は閾値スクリプトが warning で監視）
  expect(metrics['browser.editorInitialRenderMs']).toBeGreaterThan(0)
  expect(metrics['browser.undoRedoCycleMs']).toBeGreaterThan(0)
})
