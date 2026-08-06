import { describe, expect, it } from 'vitest'
import { exportPdf } from '@/domain/pdf/pdfExporter'
import type { Geometry, GeometryBase, GeometryId, GeometryStyle, LayerId } from '@/shared/types'
import type { DrawingLayer } from '@/shared/types/layer'

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
  name: '決定性',
  order: 0,
  visible: true,
  locked: false,
  printable: true,
  defaultStyle: style,
}

const line: Geometry = {
  ...base,
  id: 'det-line' as GeometryId,
  type: 'line',
  start: { x: 0, y: 0 },
  end: { x: 800, y: 400 },
}

const ctx = {
  newId: (): GeometryId => 'det-0' as GeometryId,
  now: (): string => '2026-08-06T00:00:00.000Z',
}

describe('PDF決定性（秒跨ぎ）', () => {
  it('同一ctxで1.1秒間隔の2回出力でも bytes が完全一致する', async () => {
    const a = await exportPdf([line], [LAYER], { paperSize: 'A3', orientation: 'landscape', scale: 100 }, ctx)
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const b = await exportPdf([line], [LAYER], { paperSize: 'A3', orientation: 'landscape', scale: 100 }, ctx)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(Buffer.from(a.value.bytes).equals(Buffer.from(b.value.bytes))).toBe(true)
    }
  }, 15_000)
})
