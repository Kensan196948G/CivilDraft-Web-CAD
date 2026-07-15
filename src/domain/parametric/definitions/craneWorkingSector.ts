/**
 * crane-working-sector（クレーン作業扇形）— 詳細設計仕様書 §15.1。
 * パラメータ: 中心・最小半径・最大半径・開始角・終了角（＋機種名）。生成物: 扇形・注記。
 * 扇形は外側/内側の円弧と 2 本の半径線で構成する。§15.2 に従い注記へ免責を含める。
 */
import type { Geometry, Point, ValidationIssue } from '@/shared/types'
import type { GenerationContext } from '../generationContext'
import type { ParameterSpec, ParametricObjectDefinition, ParametricParams } from '../parametricTypes'
import { asNumber, asPoint, asString, validateAgainstSchema } from '../parameterValidation'
import { makeArc, makeLine, makeText, pointOnCircle } from '../geometryHelpers'
import { CAPABILITY_DISCLAIMER } from './heavyMachineRadius'

const DEFAULT_CENTER: Point = { x: 0, y: 0 }
const DEFAULT_MIN_RADIUS = 2000
const DEFAULT_MAX_RADIUS = 8000
const DEFAULT_START_ANGLE = -60
const DEFAULT_END_ANGLE = 60
const DEFAULT_MACHINE = 'ラフタークレーン'

const SCHEMA: readonly ParameterSpec[] = [
  { name: 'center', label: '中心', type: 'point', required: true, defaultValue: DEFAULT_CENTER },
  {
    name: 'minRadius',
    label: '最小半径',
    type: 'number',
    required: true,
    min: 0,
    unit: 'mm',
    defaultValue: DEFAULT_MIN_RADIUS,
  },
  {
    name: 'maxRadius',
    label: '最大半径',
    type: 'number',
    required: true,
    exclusiveMin: 0,
    unit: 'mm',
    defaultValue: DEFAULT_MAX_RADIUS,
  },
  { name: 'startAngleDeg', label: '開始角', type: 'angle', required: true, unit: '度', defaultValue: DEFAULT_START_ANGLE },
  { name: 'endAngleDeg', label: '終了角', type: 'angle', required: true, unit: '度', defaultValue: DEFAULT_END_ANGLE },
  { name: 'machineName', label: '機種名', type: 'string', required: false, defaultValue: DEFAULT_MACHINE },
]

export const craneWorkingSectorDefinition: ParametricObjectDefinition = {
  definitionId: 'crane-working-sector',
  version: 1,
  name: 'クレーン作業扇形',
  category: '仮設',
  description: 'クレーンの作業半径範囲を扇形・注記で表す（能力判定なし）',
  parameterSchema: SCHEMA,

  validate(params: ParametricParams): readonly ValidationIssue[] {
    const issues = validateAgainstSchema(SCHEMA, params)
    const minRadius = asNumber(params.minRadius)
    const maxRadius = asNumber(params.maxRadius)
    if (minRadius !== undefined && maxRadius !== undefined && maxRadius <= minRadius) {
      issues.push({
        code: 'CRANE_RADIUS_ORDER',
        severity: 'error',
        field: 'maxRadius',
        message: '最大半径は最小半径より大きい値にしてください',
      })
    }
    return issues
  },

  generate(params: ParametricParams, ctx: GenerationContext): readonly Geometry[] {
    const center = asPoint(params.center) ?? DEFAULT_CENTER
    const minRadius = asNumber(params.minRadius) ?? DEFAULT_MIN_RADIUS
    const maxRadius = asNumber(params.maxRadius) ?? DEFAULT_MAX_RADIUS
    const startAngleDeg = asNumber(params.startAngleDeg) ?? DEFAULT_START_ANGLE
    const endAngleDeg = asNumber(params.endAngleDeg) ?? DEFAULT_END_ANGLE
    const machineName = asString(params.machineName) ?? DEFAULT_MACHINE

    const hasInner = minRadius > 0
    const innerStart = hasInner ? pointOnCircle(center, minRadius, startAngleDeg) : center
    const innerEnd = hasInner ? pointOnCircle(center, minRadius, endAngleDeg) : center
    const outerStart = pointOnCircle(center, maxRadius, startAngleDeg)
    const outerEnd = pointOnCircle(center, maxRadius, endAngleDeg)

    const result: Geometry[] = [makeArc(ctx, center, maxRadius, startAngleDeg, endAngleDeg)]
    if (hasInner) result.push(makeArc(ctx, center, minRadius, startAngleDeg, endAngleDeg))
    result.push(makeLine(ctx, innerStart, outerStart))
    result.push(makeLine(ctx, innerEnd, outerEnd))

    const midAngle = (startAngleDeg + endAngleDeg) / 2
    const labelAnchor = pointOnCircle(center, maxRadius + 300, midAngle)
    const label = `${machineName} 作業半径 ${minRadius}〜${maxRadius} ${CAPABILITY_DISCLAIMER}`
    result.push(makeText(ctx, labelAnchor, label, { horizontalAlign: 'center' }))

    return result
  },
}
