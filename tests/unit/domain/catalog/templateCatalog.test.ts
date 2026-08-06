import { describe, expect, it } from 'vitest'
import {
  getTemplateById,
  instantiateTemplate,
  TEMPLATE_CATALOG,
} from '@/domain/catalog/templateCatalog'
import type { GeometryId, GeometryStyle, GeometryType, LayerId } from '@/shared/types'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const KNOWN_TYPES: readonly GeometryType[] = [
  'line',
  'rectangle',
  'circle',
  'arc',
  'ellipse',
  'polyline',
  'spline',
  'text',
  'dimension',
  'leader',
  'hatch',
  'symbol',
  'parametricObject',
]

/** 決定的な連番ID・固定タイムスタンプを注入するコンテキスト（ADR-0013）。 */
function seqContext(): GeometryCreationContext {
  let n = 0
  return {
    newId: () => `tpl-${++n}` as GeometryId,
    now: () => '2026-07-15T00:00:00.000Z',
  }
}

describe('TEMPLATE_CATALOG', () => {
  it('エントリ数は7でidは一意', () => {
    expect(TEMPLATE_CATALOG).toHaveLength(7)
    const ids = TEMPLATE_CATALOG.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('全テンプレートのshapesは非空', () => {
    for (const t of TEMPLATE_CATALOG) {
      expect(t.shapes.length).toBeGreaterThan(0)
    }
  })

  it('全shapeのtypeは既知のGeometryType', () => {
    for (const t of TEMPLATE_CATALOG) {
      for (const s of t.shapes) {
        expect(KNOWN_TYPES).toContain(s.type)
      }
    }
  })

  it('categoryは5種（仮設/土工/舗装/測量/図面枠）のいずれか', () => {
    for (const t of TEMPLATE_CATALOG) {
      expect(['仮設', '土工', '舗装', '測量', '図面枠']).toContain(t.category)
    }
  })
})

describe('座標・角度変換の値検証', () => {
  it('pipe-culvertのarcはstartAngleDeg=180/endAngleDeg=0（Math.PI→度数法変換）', () => {
    const tpl = getTemplateById('pipe-culvert')
    expect(tpl).toBeDefined()
    const arc = tpl?.shapes.find((s) => s.type === 'arc')
    if (arc?.type !== 'arc') throw new Error('arc shape not found')
    expect(arc.startAngleDeg).toBe(180)
    expect(arc.endAngleDeg).toBe(0)
    expect(arc.center).toEqual({ x: 0, y: -50 })
    expect(arc.radius).toBe(50)
  })

  it('earthwork-sectionのhatch boundaryPointsは重複点を含む7点をas_is維持', () => {
    const tpl = getTemplateById('earthwork-section')
    const hatch = tpl?.shapes.find((s) => s.type === 'hatch')
    if (hatch?.type !== 'hatch') throw new Error('hatch shape not found')
    expect(hatch.boundaryPoints).toHaveLength(7)
    // (100,0) が連続重複（継承元データ由来）
    expect(hatch.boundaryPoints[4]).toEqual({ x: 100, y: 0 })
    expect(hatch.boundaryPoints[5]).toEqual({ x: 100, y: 0 })
    expect(hatch.angleDeg).toBe(45)
    expect(hatch.spacing).toBe(15)
  })

  it('survey-control-pointのtextはfontSize→height/rotation→rotationDeg/align既定left', () => {
    const tpl = getTemplateById('survey-control-point')
    const text = tpl?.shapes.find((s) => s.type === 'text')
    if (text?.type !== 'text') throw new Error('text shape not found')
    expect(text.anchor).toEqual({ x: 25, y: -30 })
    expect(text.text).toBe('CP')
    expect(text.height).toBe(12)
    expect(text.rotationDeg).toBe(0)
    expect(text.horizontalAlign).toBe('left')
  })

  it('paving先頭のrectangleはorigin/width/height/rotationDegへ変換されている', () => {
    const tpl = getTemplateById('paving')
    const rect = tpl?.shapes.find((s) => s.type === 'rectangle')
    if (rect?.type !== 'rectangle') throw new Error('rectangle shape not found')
    expect(rect.origin).toEqual({ x: -100, y: -10 })
    expect(rect.width).toBe(200)
    expect(rect.height).toBe(10)
    expect(rect.rotationDeg).toBe(0)
  })
})

describe('instantiateTemplate', () => {
  it('決定的ctxでid連番・タイムスタンプ・layerId/styleを合成する', () => {
    const tpl = getTemplateById('survey-control-point')
    if (!tpl) throw new Error('template not found')
    const result = instantiateTemplate(
      tpl,
      { layerId: 'layer-9' as LayerId, style },
      seqContext(),
    )
    expect(result).toHaveLength(tpl.shapes.length)
    result.forEach((g, i) => {
      expect(g.id).toBe(`tpl-${i + 1}`)
      expect(g.layerId).toBe('layer-9')
      expect(g.style).toBe(style)
      expect(g.locked).toBe(false)
      expect(g.constructionStepIds).toEqual([])
      expect(g.createdAt).toBe('2026-07-15T00:00:00.000Z')
      expect(g.updatedAt).toBe('2026-07-15T00:00:00.000Z')
    })
  })

  it('生成Geometryは元shapeの形状フィールドを保持する（先頭circle）', () => {
    const tpl = getTemplateById('survey-control-point')
    if (!tpl) throw new Error('template not found')
    const [circle] = instantiateTemplate(tpl, { layerId: 'layer-1' as LayerId, style }, seqContext())
    if (circle?.type !== 'circle') throw new Error('expected circle first')
    expect(circle.center).toEqual({ x: 0, y: 0 })
    expect(circle.radius).toBe(20)
  })

  it('実体化しても元テンプレートは変更されない（イミュータブル）', () => {
    const before = structuredClone(getTemplateById('paving'))
    const tpl = getTemplateById('paving')
    if (!tpl) throw new Error('template not found')
    instantiateTemplate(tpl, { layerId: 'layer-1' as LayerId, style }, seqContext())
    expect(getTemplateById('paving')).toEqual(before)
  })

  it('ctx省略時はdefaultCreationContextで一意idが付与される', () => {
    const tpl = getTemplateById('survey-control-point')
    if (!tpl) throw new Error('template not found')
    const result = instantiateTemplate(tpl, { layerId: 'layer-1' as LayerId, style })
    const ids = result.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((v) => typeof v === 'string' && v.length > 0)).toBe(true)
  })
})

describe('getTemplateById', () => {
  it('存在するidでテンプレートを返す', () => {
    expect(getTemplateById('construction-zone')?.name).toBe('工事ゾーン')
  })

  it('存在しないidでundefinedを返す', () => {
    expect(getTemplateById('no-such-id')).toBeUndefined()
  })

  it('表題欄テンプレート（A3）を取得・実体化できる（Issue #46）', () => {
    const tpl = getTemplateById('title-block-a3')
    expect(tpl?.category).toBe('図面枠')
    expect(tpl?.shapes.length).toBeGreaterThan(10)

    const geometries = instantiateTemplate(tpl!, { layerId: 'layer-1' as LayerId, style }, seqContext())
    expect(geometries.some((g) => g.type === 'rectangle')).toBe(true)
    expect(geometries.some((g) => g.type === 'line')).toBe(true)
    expect(geometries.some((g) => g.type === 'text')).toBe(true)
    expect(new Set(geometries.map((g) => g.id)).size).toBe(geometries.length)
  })
})
