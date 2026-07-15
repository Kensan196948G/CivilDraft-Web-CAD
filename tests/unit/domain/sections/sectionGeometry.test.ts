import { describe, expect, it } from 'vitest'
import type { GeometryId, GeometryStyle, LayerId, SurveyPointId } from '@/shared/types'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import {
  buildSectionGeometries,
  sectionPointToPoint,
  type Section,
} from '@/domain/sections'

const SP = 'sp-1' as SurveyPointId
const LAYER = 'layer-1' as LayerId

const STYLE: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

/** 決定的な ID/timestamp を返すテスト用コンテキスト（ADR-0013）。 */
function fixedContext(): GeometryCreationContext {
  let counter = 0
  return {
    newId: () => `gid-${counter++}` as GeometryId,
    now: () => '2026-01-01T00:00:00.000Z',
  }
}

const cutSection: Section = {
  id: 'sec-1',
  surveyPointId: SP,
  station: 0,
  existingGround: [
    { offset: -10, elevation: 5 },
    { offset: 10, elevation: 5 },
  ],
  plannedGround: [
    { offset: -10, elevation: 0 },
    { offset: 10, elevation: 0 },
  ],
}

describe('sectionPointToPoint / 座標写像', () => {
  it('offset→x はそのまま、elevation→y は符号反転（Y下向き整合）', () => {
    expect(sectionPointToPoint({ offset: 3, elevation: 4 })).toEqual({ x: 3, y: -4 })
  })
})

describe('buildSectionGeometries / 地盤線生成', () => {
  it('現況線・計画線を polyline で生成し、ctx で ID/timestamp を注入する', () => {
    const geometries = buildSectionGeometries(
      cutSection,
      { layerId: LAYER, existingStyle: STYLE, plannedStyle: STYLE },
      fixedContext(),
    )
    const polylines = geometries.filter((g) => g.type === 'polyline')
    expect(polylines).toHaveLength(2)
    const existing = polylines[0]!
    expect(existing.type).toBe('polyline')
    if (existing.type !== 'polyline') return
    expect(existing.closed).toBe(false)
    expect(existing.layerId).toBe(LAYER)
    expect(existing.constructionStepIds).toEqual([])
    expect(existing.createdAt).toBe('2026-01-01T00:00:00.000Z')
    // 現況線 (-10,5)-(10,5) → 内部座標 (-10,-5)-(10,-5)
    expect(existing.points).toEqual([
      { x: -10, y: -5 },
      { x: 10, y: -5 },
    ])
  })

  it('点が2未満の地盤線は退化図形を生成せず省略する', () => {
    const degenerate: Section = {
      ...cutSection,
      plannedGround: [{ offset: 0, elevation: 0 }],
    }
    const geometries = buildSectionGeometries(
      degenerate,
      { layerId: LAYER, existingStyle: STYLE, plannedStyle: STYLE },
      fixedContext(),
    )
    // 現況線のみ生成される（計画線は 1 点なので省略）。
    expect(geometries.filter((g) => g.type === 'polyline')).toHaveLength(1)
  })
})

describe('buildSectionGeometries / 領域ハッチ生成', () => {
  it('ハッチスタイル指定時、切土領域を hatch で塗る', () => {
    const geometries = buildSectionGeometries(
      cutSection,
      {
        layerId: LAYER,
        existingStyle: STYLE,
        plannedStyle: STYLE,
        cutHatchStyle: STYLE,
        fillHatchStyle: STYLE,
      },
      fixedContext(),
    )
    const hatches = geometries.filter((g) => g.type === 'hatch')
    // 全切土断面なので切土ハッチが 1 枚、盛土ハッチは 0 枚。
    expect(hatches).toHaveLength(1)
    const hatch = hatches[0]!
    if (hatch.type !== 'hatch') return
    expect(hatch.pattern).toBe('rock')
  })

  it('面積未確定の断面はハッチを省略し線のみ生成する', () => {
    const broken: Section = {
      id: 'sec-x',
      surveyPointId: SP,
      station: 0,
      existingGround: [
        { offset: 0, elevation: 0 },
        { offset: 0, elevation: 5 },
      ],
      plannedGround: [
        { offset: -10, elevation: 0 },
        { offset: 10, elevation: 0 },
      ],
    }
    const geometries = buildSectionGeometries(
      broken,
      { layerId: LAYER, existingStyle: STYLE, plannedStyle: STYLE, cutHatchStyle: STYLE },
      fixedContext(),
    )
    expect(geometries.filter((g) => g.type === 'hatch')).toHaveLength(0)
    expect(geometries.filter((g) => g.type === 'polyline').length).toBeGreaterThan(0)
  })
})
