import { describe, expect, it } from 'vitest'
import { LAYER_TEMPLATES, findLayerTemplate } from '@/domain/catalog/layerTemplates'

describe('LAYER_TEMPLATES（工種別レイヤーテンプレート / Issue #40）', () => {
  it('5種のテンプレートが定義されている', () => {
    expect(LAYER_TEMPLATES).toHaveLength(5)
    expect(LAYER_TEMPLATES.map((t) => t.id)).toEqual([
      'temporary-yard',
      'temporary-works',
      'survey',
      'quantity',
      'general',
    ])
  })

  it('全テンプレートのレイヤー名は重複せず、色は #RRGGBB 形式・線幅は正の値', () => {
    for (const template of LAYER_TEMPLATES) {
      expect(template.layers.length).toBeGreaterThan(0)
      const names = template.layers.map((l) => l.name)
      expect(new Set(names).size).toBe(names.length)
      for (const layer of template.layers) {
        expect(layer.strokeColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
        expect(layer.lineWidth).toBeGreaterThan(0)
        expect(['continuous', 'dashed', 'dashDot', 'double']).toContain(layer.lineType)
      }
    }
  })

  it('findLayerTemplate は未知IDに undefined を返す', () => {
    expect(findLayerTemplate('temporary-yard')).toBeDefined()
    expect(findLayerTemplate('unknown-template')).toBeUndefined()
  })
})
