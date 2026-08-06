/**
 * ブラウザ性能: 10,000図形の復元描画（Issue #63）。
 *
 * DXF取込 UI（Issue #118）配線前のため、IndexedDB の自動保存スナップショットへ
 * 10,000 図形を事前投入し、ホームの「復元」からエディタ描画までの時間を計測する。
 * 実測値は browser-metrics-large.json へ書き出し、
 * scripts/check-perf-thresholds.mjs が閾値超過を warning として報告する。
 *
 * 注意: perf.spec.ts と並行実行されるため、メトリクスファイルは分離している。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resultsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'performance', 'results')
const resultsPath = join(resultsDir, 'browser-metrics-large.json')

const SNAPSHOT_COUNT = 10_000

test('10,000図形の自動保存復元・エディタ描画性能', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByText('ホーム・案件一覧').first()).toBeVisible()

  // IndexedDB へ10k図形スナップショットを事前投入してから再読込する
  await page.evaluate(async (count) => {
    const layer = {
      id: 'layer-default',
      name: '性能テスト',
      order: 0,
      visible: true,
      locked: false,
      printable: true,
      defaultStyle: {
        strokeColor: '#1f2937',
        strokeWidth: 1,
        lineType: 'continuous',
        opacity: 1,
        printable: true,
      },
    }
    const style = layer.defaultStyle
    const geometries = []
    for (let i = 0; i < count; i++) {
      geometries.push({
        id: `perf-browser-${i}`,
        layerId: 'layer-default',
        style,
        constructionStepIds: [],
        locked: false,
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z',
        type: 'line',
        start: { x: i * 10, y: 0 },
        end: { x: i * 10 + 5, y: 10 },
      })
    }
    const snapshot = { savedAt: new Date().toISOString(), geometries, layers: [layer] }
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('civildraft-autosave', 1)
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('drafts')) {
          open.result.createObjectStore('drafts')
        }
      }
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction('drafts', 'readwrite')
        tx.objectStore('drafts').put(JSON.stringify(snapshot), 'latest')
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      open.onerror = () => reject(open.error)
    })
  }, SNAPSHOT_COUNT)

  await page.reload()
  await expect(page.getByText('ホーム・案件一覧').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '復元' })).toBeVisible({ timeout: 15_000 })

  const renderStart = Date.now()
  await page.getByRole('button', { name: '復元' }).click()
  await expect(page.getByRole('button', { name: '共有保存' })).toBeVisible()
  await expect(page.getByTestId('canvas-stage-container')).toBeVisible()
  // 2フレーム待ち、React コミット＋Konva 描画反映後の時点で計測を確定する
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  const renderMs = Date.now() - renderStart

  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(resultsPath, JSON.stringify({ 'browser.render10kMs': renderMs }, null, 2))
  await testInfo.attach('browser-perf-metrics-large', {
    body: JSON.stringify({ 'browser.render10kMs': renderMs }, null, 2),
    contentType: 'application/json',
  })

  expect(renderMs).toBeGreaterThan(0)
})
