/**
 * 性能ベンチマーク（Issue #63 / #45 の性能回帰部分）。
 *
 * 実測値を tests/performance/results/perf-metrics.json へ書き出す。
 * 閾値判定は scripts/check-perf-thresholds.mjs（warning 扱い・fail にしない）。
 * このディレクトリは通常の npm test 対象外（vitest.perf.config.ts 経由で npm run perf が実行）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEditorStore } from '@/app/store/editorStore'
import { createAddGeometryCommand } from '@/domain/commands/geometryCommands'
import { exportDxf } from '@/domain/dxf/dxfExporter'
import { importDxf } from '@/domain/dxf/dxfImporter'
import { GeometryIndex } from '@/domain/geometry/spatialIndex'
import { exportPdf } from '@/domain/pdf/pdfExporter'
import type { DrawingLayer } from '@/shared/types/layer'
import type { Geometry, GeometryBase, GeometryId, GeometryStyle, LayerId } from '@/shared/types'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const base: Omit<GeometryBase, 'id' | 'type'> = {
  layerId: 'layer-default' as LayerId,
  style,
  constructionStepIds: [],
  locked: false,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
}

const LAYER: DrawingLayer = {
  id: 'layer-default' as LayerId,
  name: '性能テスト',
  order: 0,
  visible: true,
  locked: false,
  printable: true,
  defaultStyle: style,
}

function lineGeometry(i: number): Geometry {
  return {
    ...base,
    id: `perf-line-${i}` as GeometryId,
    type: 'line',
    start: { x: i * 10, y: 0 },
    end: { x: i * 10 + 5, y: 10 },
  }
}

function lines(count: number): Geometry[] {
  return Array.from({ length: count }, (_, i) => lineGeometry(i))
}

/** LINE エンティティ N 件の DXF 文字列を組み立てる（200,000件 = 約10MB級）。 */
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
  return (
    `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n` +
    `0\nSECTION\n2\nENTITIES\n${body.join('\n')}\n0\nENDSEC\n0\nEOF\n`
  )
}

const metrics: Record<string, number> = {}

function record(key: string, value: number): void {
  metrics[key] = Math.round(value)
}

afterAll(() => {
  const resultsDir = join(dirname(fileURLToPath(import.meta.url)), 'results')
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(join(resultsDir, 'perf-metrics.json'), JSON.stringify(metrics, null, 2))
})

describe('性能ベンチマーク（Issue #63）', () => {
  it('10,000図形の空間索引構築・検索', () => {
    const geometries = lines(10_000)
    const index = new GeometryIndex()

    const loadStart = performance.now()
    index.load(geometries)
    record('node.geometryIndex10kLoadMs', performance.now() - loadStart)
    expect(index.size).toBe(10_000)

    const searchStart = performance.now()
    for (let i = 0; i < 100; i++) {
      const x = i * 100
      index.search({ minX: x, minY: -10, maxX: x + 10_000, maxY: 10_000 })
    }
    record('node.geometryIndexSearch100Ms', performance.now() - searchStart)
  }, 60_000)

  it('大規模DXF（200,000 LINE・約10MB級）の取込', () => {
    const dxf = buildLargeDxf(200_000)
    expect(dxf.length).toBeGreaterThan(9_000_000)

    const start = performance.now()
    const result = importDxf(dxf)
    record('node.dxf10mbParseMs', performance.now() - start)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.geometries.length).toBeGreaterThan(0)
      record('node.dxf10mbEntityCount', result.value.geometries.length)
    }
  }, 180_000)

  it('10,000図形のDXF出力', () => {
    const start = performance.now()
    const dxf = exportDxf(lines(10_000), [LAYER])
    record('node.dxf10kExportMs', performance.now() - start)
    record('node.dxf10kOutputBytes', dxf.length)
    expect(dxf).toContain('ENTITIES')
  }, 120_000)

  it('2,000図形のPDF出力（A3・1:100）', async () => {
    const start = performance.now()
    const result = await exportPdf(lines(2_000), [LAYER], {
      paperSize: 'A3',
      orientation: 'landscape',
      scale: 100,
    })
    record('node.pdf2kExportMs', performance.now() - start)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.bytes.length).toBeGreaterThan(1_000)
    }
  }, 180_000)

  it('1,000操作のUndo/Redo（履歴上限100の負荷）', () => {
    const store = createEditorStore()
    for (let i = 0; i < 1_000; i++) {
      store.getState().dispatchCommand(createAddGeometryCommand(lineGeometry(i)))
    }

    const start = performance.now()
    for (let i = 0; i < 1_000; i++) {
      store.getState().undo()
    }
    for (let i = 0; i < 1_000; i++) {
      store.getState().redo()
    }
    record('node.history1000OpsMs', performance.now() - start)
    expect(store.getState().geometries).toHaveLength(1_000)
  }, 120_000)
})
