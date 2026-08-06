/**
 * ブラウザ性能: 10,000図形・10MB級DXFの取込→描画（Issue #63）。
 *
 * 取込UI（Issue #118 / PR #130）経由で実ファイルを取り込み、
 * パース＋エディタ反映までの時間を計測する。
 * 実測値は browser-metrics-dxf.json へ書き出し、
 * scripts/check-perf-thresholds.mjs が閾値超過を warning として報告する。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resultsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'performance', 'results')
const resultsPath = join(resultsDir, 'browser-metrics-dxf.json')

const ENTITY_COUNT = 10_000

/** LINE 10,000件 + 999コメントで約10MB級にパディングしたDXFを組み立てる。 */
function buildLargeDxf(entityCount: number): string {
  const body: string[] = []
  for (let i = 0; i < entityCount; i++) {
    body.push(
      '0',
      'LINE',
      '8',
      '0',
      '10',
      String(i * 10),
      '20',
      String(i % 1000),
      '11',
      String(i * 10 + 5),
      '21',
      String((i % 1000) + 10),
    )
  }
  const entities = `0\nSECTION\n2\nENTITIES\n${body.join('\n')}\n0\nENDSEC\n`
  // 999 = コメント行（パーサは無視）。10MB級サイズを確保するためのパディング。
  const padding = `999\n${'p'.repeat(9_000_000)}\n`
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n${entities}${padding}0\nEOF\n`
}

test('10,000図形・10MB級DXFの取込→エディタ描画性能', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByText('ホーム・案件一覧').first()).toBeVisible()

  await page.getByRole('button', { name: '＋ 新規案件・図面' }).click()
  await page.getByLabel('案件名').fill('E2E-DXF性能')
  await page.getByLabel('初期図面名').fill('E2E-DXF性能図')
  await page.getByRole('button', { name: '案件と図面を作成' }).click()
  await expect(page.getByText('案件詳細: E2E-DXF性能')).toBeVisible()

  await page.getByRole('button', { name: /^作図/ }).click()
  await page.getByRole('button', { name: '✏️ CAD編集' }).click()
  await expect(page.getByRole('button', { name: '共有保存' })).toBeVisible()

  mkdirSync(resultsDir, { recursive: true })
  const dxf = buildLargeDxf(ENTITY_COUNT)
  expect(Buffer.byteLength(dxf, 'utf8')).toBeGreaterThan(9_000_000)

  const importStart = Date.now()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'large.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(dxf, 'utf8'),
  })
  await expect(
    page.getByText(new RegExp(`DXF取込完了: 図形 ${ENTITY_COUNT} 件`)),
  ).toBeVisible({ timeout: 90_000 })
  await expect(page.getByTestId('canvas-stage-container')).toBeVisible()
  const importRenderMs = Date.now() - importStart

  writeFileSync(
    resultsPath,
    JSON.stringify(
      { 'browser.dxf10kImportRenderMs': importRenderMs, 'browser.dxfImportEntityCount': ENTITY_COUNT },
      null,
      2,
    ),
  )
  await testInfo.attach('browser-perf-metrics-dxf', {
    body: JSON.stringify({ 'browser.dxf10kImportRenderMs': importRenderMs }, null, 2),
    contentType: 'application/json',
  })

  expect(importRenderMs).toBeGreaterThan(0)
}, 150_000)
