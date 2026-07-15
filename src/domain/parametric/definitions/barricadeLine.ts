/**
 * barricade-line（バリケード記号列）— 詳細設計仕様書 §15.1。
 * パラメータ: 経路・配置間隔。生成物: バリケード記号列（経路に沿った記号群）。
 */
import type { Geometry, ValidationIssue } from '@/shared/types'
import type { GenerationContext } from '../generationContext'
import type { ParameterSpec, ParametricObjectDefinition, ParametricParams } from '../parametricTypes'
import { asNumber, asPointList, validateAgainstSchema } from '../parameterValidation'
import { makeSymbol, sampleAlongPath } from '../geometryHelpers'

const DEFAULT_PATH = [
  { x: 0, y: 0 },
  { x: 6000, y: 0 },
]
const DEFAULT_SPACING = 1500

/** バリケード記号の symbolId。 */
export const BARRICADE_SYMBOL_ID = 'barricade'

const SCHEMA: readonly ParameterSpec[] = [
  { name: 'path', label: '経路', type: 'pointList', required: true, min: 2, defaultValue: DEFAULT_PATH },
  { name: 'spacing', label: '配置間隔', type: 'number', required: true, exclusiveMin: 0, unit: 'mm', defaultValue: DEFAULT_SPACING },
]

export const barricadeLineDefinition: ParametricObjectDefinition = {
  definitionId: 'barricade-line',
  version: 1,
  name: 'バリケード列',
  category: '仮設',
  description: '経路に沿ったバリケード記号列',
  parameterSchema: SCHEMA,

  validate(params: ParametricParams): readonly ValidationIssue[] {
    return validateAgainstSchema(SCHEMA, params)
  },

  generate(params: ParametricParams, ctx: GenerationContext): readonly Geometry[] {
    const path = asPointList(params.path) ?? DEFAULT_PATH
    const spacing = asNumber(params.spacing) ?? DEFAULT_SPACING

    return sampleAlongPath(path, spacing).map((sample) =>
      makeSymbol(ctx, BARRICADE_SYMBOL_ID, sample.point, sample.angleDeg, 1),
    )
  },
}
