import { describe, expect, it } from 'vitest'
import { createDemoDrawingContent } from '@/app/demoDrawingContents'

const TYPE_CODES = [
  'temporary-yard-plan',
  'temporary-plan',
  'earthwork-plan',
  'quantity-basis',
] as const

describe('demoDrawingContents（図面ごとのダミー図形）', () => {
  it('全図面種別で空でない図形とレイヤーを返し、IDが重複しない', () => {
    for (const drawingType of TYPE_CODES) {
      const content = createDemoDrawingContent(drawingType, 'DWG-014')
      expect(content.geometries.length).toBeGreaterThan(10)
      expect(content.layers.length).toBeGreaterThan(1)
      expect(new Set(content.geometries.map((item) => item.id)).size).toBe(content.geometries.length)
      expect(new Set(content.layers.map((item) => item.id)).size).toBe(content.layers.length)
    }
  })

  it('未知・未指定の図面種別は汎用サンプルを返す', () => {
    const content = createDemoDrawingContent(undefined, 'DWG-001')
    expect(content.geometries.length).toBeGreaterThanOrEqual(5)
    expect(content.geometries.some((item) => item.type === 'line')).toBe(true)
    expect(content.geometries.some((item) => item.type === 'circle')).toBe(true)
  })

  it('種別ごとの代表図形を含む（2D CAD機能のデモ用）', () => {
    const yard = createDemoDrawingContent('temporary-yard-plan', 'DWG-014')
    expect(yard.geometries.some((item) => item.type === 'circle')).toBe(true)
    expect(yard.geometries.some((item) => item.type === 'rectangle')).toBe(true)
    expect(yard.geometries.some((item) => item.type === 'mline')).toBe(true)

    const section = createDemoDrawingContent('earthwork-plan', 'DWG-022')
    expect(section.geometries.filter((item) => item.type === 'polyline').length).toBeGreaterThanOrEqual(2)
    expect(section.geometries.some((item) => item.type === 'hatch')).toBe(true)

    const quantity = createDemoDrawingContent('quantity-basis', 'DWG-025')
    expect(quantity.geometries.some((item) => item.type === 'dimension')).toBe(true)
    expect(quantity.geometries.some((item) => item.type === 'leader')).toBe(true)
    expect(quantity.geometries.some((item) => item.type === 'text')).toBe(true)
  })

  it('同じ図面は常に同じ内容になり、図面番号でバリエーションが変わる', () => {
    const first = createDemoDrawingContent('temporary-yard-plan', 'DWG-014')
    const second = createDemoDrawingContent('temporary-yard-plan', 'DWG-014')
    expect(second).toEqual(first)

    const variantA = createDemoDrawingContent('temporary-yard-plan', 'DWG-021')
    const variantB = createDemoDrawingContent('temporary-yard-plan', 'DWG-022')
    expect(variantA).not.toEqual(variantB)
  })

  it('図形はADR-0012座標（mm・Y下方向）の範囲内に配置される', () => {
    const content = createDemoDrawingContent('temporary-yard-plan', 'DWG-014')
    for (const item of content.geometries) {
      if (item.type === 'line') {
        expect(item.start.x).toBeGreaterThanOrEqual(0)
        expect(item.end.y).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
