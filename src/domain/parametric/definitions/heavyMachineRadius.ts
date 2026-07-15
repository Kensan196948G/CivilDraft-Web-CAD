/**
 * heavy-machine-radius（重機旋回半径）— 詳細設計仕様書 §15.1。
 * パラメータ: 中心・旋回半径・機種名。生成物: 円・塗り（ハッチ）・注記。
 * §15.2 に従い注記へ「※能力判定なし」を含める（安全能力は判定しない旨を出力へ明示）。
 */
import type { Geometry, Point, ValidationIssue } from '@/shared/types'
import type { GenerationContext } from '../generationContext'
import type { ParameterSpec, ParametricObjectDefinition, ParametricParams } from '../parametricTypes'
import { asNumber, asPoint, asString, validateAgainstSchema } from '../parameterValidation'
import { circlePolygon, makeCircle, makeHatch, makeText } from '../geometryHelpers'

const DEFAULT_CENTER: Point = { x: 0, y: 0 }
const DEFAULT_RADIUS = 4000
const DEFAULT_MACHINE = 'バックホウ'

/** 安全能力を判定しない旨の免責注記（§15.2）。重機・クレーン共通で用いる。 */
export const CAPABILITY_DISCLAIMER = '※能力判定なし'

const SCHEMA: readonly ParameterSpec[] = [
  { name: 'center', label: '中心', type: 'point', required: true, defaultValue: DEFAULT_CENTER },
  {
    name: 'radius',
    label: '旋回半径',
    type: 'number',
    required: true,
    exclusiveMin: 0,
    unit: 'mm',
    defaultValue: DEFAULT_RADIUS,
  },
  { name: 'machineName', label: '機種名', type: 'string', required: true, defaultValue: DEFAULT_MACHINE },
]

export const heavyMachineRadiusDefinition: ParametricObjectDefinition = {
  definitionId: 'heavy-machine-radius',
  version: 1,
  name: '重機旋回半径',
  category: '仮設',
  description: '重機の旋回半径を円・塗り・注記で表す（能力判定なし）',
  parameterSchema: SCHEMA,

  validate(params: ParametricParams): readonly ValidationIssue[] {
    return validateAgainstSchema(SCHEMA, params)
  },

  generate(params: ParametricParams, ctx: GenerationContext): readonly Geometry[] {
    const center = asPoint(params.center) ?? DEFAULT_CENTER
    const radius = asNumber(params.radius) ?? DEFAULT_RADIUS
    const machineName = asString(params.machineName) ?? DEFAULT_MACHINE

    // 塗り: 円周を 32 角形近似した境界に平行ハッチ。密度は半径に比例させる。
    const fillSpacing = radius / 8
    const label = `${machineName} 旋回半径 R=${radius} ${CAPABILITY_DISCLAIMER}`

    return [
      makeCircle(ctx, center, radius),
      makeHatch(ctx, circlePolygon(center, radius, 32), 'parallel', 45, fillSpacing),
      makeText(ctx, { x: center.x, y: center.y - radius - 200 }, label, { horizontalAlign: 'center' }),
    ]
  },
}
