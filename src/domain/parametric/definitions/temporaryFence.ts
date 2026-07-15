/**
 * temporary-fence（仮囲い）— 詳細設計仕様書 §15.1。
 * パラメータ: 経路・高さ属性・支柱間隔。生成物: 線（フェンス線）・支柱記号。
 * height は平面図の形状には現れない属性値のため図形生成には用いず、parameters に保持する。
 */
import type { Geometry, ValidationIssue } from '@/shared/types'
import type { GenerationContext } from '../generationContext'
import type { ParameterSpec, ParametricObjectDefinition, ParametricParams } from '../parametricTypes'
import { asNumber, asPointList, validateAgainstSchema } from '../parameterValidation'
import { makePolyline, makeSymbol, sampleAlongPath } from '../geometryHelpers'

const DEFAULT_PATH = [
  { x: 0, y: 0 },
  { x: 10000, y: 0 },
]
const DEFAULT_HEIGHT = 3000
const DEFAULT_POST_SPACING = 2000

/** 支柱記号の symbolId。symbolCatalog 側の登録キーと対応させる。 */
export const FENCE_POST_SYMBOL_ID = 'fence-post'

const SCHEMA: readonly ParameterSpec[] = [
  { name: 'path', label: '経路', type: 'pointList', required: true, min: 2, defaultValue: DEFAULT_PATH },
  { name: 'height', label: '高さ', type: 'number', required: true, exclusiveMin: 0, unit: 'mm', defaultValue: DEFAULT_HEIGHT },
  { name: 'postSpacing', label: '支柱間隔', type: 'number', required: true, exclusiveMin: 0, unit: 'mm', defaultValue: DEFAULT_POST_SPACING },
]

export const temporaryFenceDefinition: ParametricObjectDefinition = {
  definitionId: 'temporary-fence',
  version: 1,
  name: '仮囲い',
  category: '仮設',
  description: '経路に沿ったフェンス線と支柱記号',
  parameterSchema: SCHEMA,

  validate(params: ParametricParams): readonly ValidationIssue[] {
    return validateAgainstSchema(SCHEMA, params)
  },

  generate(params: ParametricParams, ctx: GenerationContext): readonly Geometry[] {
    const path = asPointList(params.path) ?? DEFAULT_PATH
    const postSpacing = asNumber(params.postSpacing) ?? DEFAULT_POST_SPACING

    const result: Geometry[] = [makePolyline(ctx, path, false)]
    for (const sample of sampleAlongPath(path, postSpacing)) {
      result.push(makeSymbol(ctx, FENCE_POST_SYMBOL_ID, sample.point, sample.angleDeg, 1))
    }
    return result
  },
}
