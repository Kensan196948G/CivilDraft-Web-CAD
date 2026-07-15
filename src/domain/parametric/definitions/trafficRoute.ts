/**
 * traffic-route（搬入路・方向矢印）— 詳細設計仕様書 §15.1。
 * パラメータ: 経路・幅・矢印間隔。生成物: 搬入路（中心線に対する両縁）・方向矢印記号。
 */
import type { Geometry, ValidationIssue } from '@/shared/types'
import type { GenerationContext } from '../generationContext'
import type { ParameterSpec, ParametricObjectDefinition, ParametricParams } from '../parametricTypes'
import { asNumber, asPointList, validateAgainstSchema } from '../parameterValidation'
import { makePolyline, makeSymbol, offsetPath, sampleAlongPath } from '../geometryHelpers'

const DEFAULT_PATH = [
  { x: 0, y: 0 },
  { x: 12000, y: 0 },
]
const DEFAULT_WIDTH = 4000
const DEFAULT_ARROW_SPACING = 3000

/** 方向矢印の symbolId。 */
export const ARROW_SYMBOL_ID = 'arrow'

const SCHEMA: readonly ParameterSpec[] = [
  { name: 'path', label: '経路', type: 'pointList', required: true, min: 2, defaultValue: DEFAULT_PATH },
  { name: 'width', label: '幅', type: 'number', required: true, exclusiveMin: 0, unit: 'mm', defaultValue: DEFAULT_WIDTH },
  { name: 'arrowSpacing', label: '矢印間隔', type: 'number', required: true, exclusiveMin: 0, unit: 'mm', defaultValue: DEFAULT_ARROW_SPACING },
]

export const trafficRouteDefinition: ParametricObjectDefinition = {
  definitionId: 'traffic-route',
  version: 1,
  name: '搬入路',
  category: '仮設',
  description: '中心線に対する両縁と方向矢印を持つ搬入路',
  parameterSchema: SCHEMA,

  validate(params: ParametricParams): readonly ValidationIssue[] {
    return validateAgainstSchema(SCHEMA, params)
  },

  generate(params: ParametricParams, ctx: GenerationContext): readonly Geometry[] {
    const path = asPointList(params.path) ?? DEFAULT_PATH
    const width = asNumber(params.width) ?? DEFAULT_WIDTH
    const arrowSpacing = asNumber(params.arrowSpacing) ?? DEFAULT_ARROW_SPACING

    const half = width / 2
    const result: Geometry[] = [
      makePolyline(ctx, offsetPath(path, half), false),
      makePolyline(ctx, offsetPath(path, -half), false),
    ]
    for (const sample of sampleAlongPath(path, arrowSpacing)) {
      result.push(makeSymbol(ctx, ARROW_SYMBOL_ID, sample.point, sample.angleDeg, 1))
    }
    return result
  },
}
