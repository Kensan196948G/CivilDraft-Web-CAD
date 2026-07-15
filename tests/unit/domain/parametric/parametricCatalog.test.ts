import { describe, expect, it } from 'vitest'
import type { GeometryId, GeometryStyle, LayerId, ParametricGeometry } from '@/shared/types'
import type { GenerationContext } from '@/domain/parametric/generationContext'
import {
  generateParametric,
  getDefinitionById,
  PARAMETRIC_CATALOG,
  regenerate,
} from '@/domain/parametric'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const GEN_TIME = '2026-07-15T09:00:00.000Z'
const LAYER = 'layer-1' as LayerId

function seqContext(prefix = 'pm'): GenerationContext {
  let n = 0
  return {
    newId: () => `${prefix}-${++n}` as GeometryId,
    now: () => GEN_TIME,
    layerId: LAYER,
    style,
  }
}

describe('PARAMETRIC_CATALOG', () => {
  it('§15.1 の7定義を保持し definitionId は一意', () => {
    expect(PARAMETRIC_CATALOG).toHaveLength(7)
    const ids = PARAMETRIC_CATALOG.map((d) => d.definitionId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'heavy-machine-radius',
      'crane-working-sector',
      'steel-plate-array',
      'temporary-fence',
      'barricade-line',
      'slope-pattern',
      'traffic-route',
    ])
  })

  it('全定義に name/category/parameterSchema があり version>=1', () => {
    for (const def of PARAMETRIC_CATALOG) {
      expect(def.name.length).toBeGreaterThan(0)
      expect(['仮設', '土工', '舗装', '測量']).toContain(def.category)
      expect(def.parameterSchema.length).toBeGreaterThan(0)
      expect(def.version).toBeGreaterThanOrEqual(1)
    }
  })

  it('getDefinitionById は該当を返し、未知IDは undefined', () => {
    expect(getDefinitionById('steel-plate-array')?.definitionId).toBe('steel-plate-array')
    expect(getDefinitionById('no-such-id')).toBeUndefined()
  })
})

describe('generateParametric（validate→generate を Result で束ねる）', () => {
  it('検証成功時は図形配列を ok:true で返す', () => {
    const def = getDefinitionById('steel-plate-array')!
    const result = generateParametric(
      def,
      { origin: { x: 0, y: 0 }, plateWidth: 1000, plateLength: 2000, rows: 1, cols: 2 },
      seqContext(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(2)
  })

  it('検証エラー時は生成せず ok:false で ValidationIssue を返す', () => {
    const def = getDefinitionById('heavy-machine-radius')!
    const result = generateParametric(
      def,
      { center: { x: 0, y: 0 }, radius: -1, machineName: 'x' },
      seqContext(),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.some((i) => i.severity === 'error')).toBe(true)
  })
})

describe('regenerate（§15.2 再生成規則）', () => {
  function makeParametric(overrides: Partial<ParametricGeometry> = {}): ParametricGeometry {
    return {
      id: 'param-1' as GeometryId,
      layerId: LAYER,
      type: 'parametricObject',
      style,
      constructionStepIds: [],
      locked: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      definitionId: 'steel-plate-array',
      definitionVersion: 1,
      parameters: { origin: { x: 0, y: 0 }, plateWidth: 1000, plateLength: 2000, rows: 1, cols: 2 },
      generatedGeometryIds: ['old-1' as GeometryId, 'old-2' as GeometryId],
      ...overrides,
    }
  }

  it('旧IDを破棄し新IDを発番、本体を更新する', () => {
    const parametric = makeParametric()
    const result = regenerate(parametric, PARAMETRIC_CATALOG, seqContext())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { parametric: updated, generated } = result.value
    // 新パラメータで2枚生成、新ID
    expect(generated).toHaveLength(2)
    expect(generated.map((g) => g.id)).toEqual(['pm-1', 'pm-2'])
    // 旧IDは generatedGeometryIds から消える
    expect(updated.generatedGeometryIds).toEqual(['pm-1', 'pm-2'])
    expect(updated.generatedGeometryIds).not.toContain('old-1')
    expect(updated.generatedGeometryIds).not.toContain('old-2')
    // 本体更新: updatedAt / definitionVersion / parameters 保持
    expect(updated.updatedAt).toBe(GEN_TIME)
    expect(updated.definitionVersion).toBe(1)
    expect(updated.parameters).toEqual(parametric.parameters)
    expect(updated.id).toBe(parametric.id)
  })

  it('定義未検出は PARAMETRIC_DEFINITION_NOT_FOUND エラー', () => {
    const parametric = makeParametric({ definitionId: 'unknown-def' })
    const result = regenerate(parametric, PARAMETRIC_CATALOG, seqContext())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error[0]?.code).toBe('PARAMETRIC_DEFINITION_NOT_FOUND')
  })

  it('パラメータ不正は生成せずエラーを返す', () => {
    const parametric = makeParametric({
      parameters: { origin: { x: 0, y: 0 }, plateWidth: 1000, plateLength: 2000, rows: 0, cols: 2 },
    })
    const result = regenerate(parametric, PARAMETRIC_CATALOG, seqContext())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.some((i) => i.code === 'PARAM_RANGE')).toBe(true)
  })
})
