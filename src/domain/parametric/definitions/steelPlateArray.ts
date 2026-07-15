/**
 * steel-plate-array（敷鉄板群）— 詳細設計仕様書 §15.1。
 * パラメータ: 原点・幅・長さ・行列（rows/cols）・間隔（gap）。生成物: 敷鉄板群（矩形配列）。
 */
import type { Geometry, Point, ValidationIssue } from '@/shared/types'
import type { GenerationContext } from '../generationContext'
import type { ParameterSpec, ParametricObjectDefinition, ParametricParams } from '../parametricTypes'
import { asInteger, asNumber, asPoint, validateAgainstSchema } from '../parameterValidation'
import { makeRectangle } from '../geometryHelpers'

const DEFAULT_ORIGIN: Point = { x: 0, y: 0 }
const DEFAULT_PLATE_WIDTH = 1524 // 敷鉄板 5尺 × 10尺 の代表寸法（mm）
const DEFAULT_PLATE_LENGTH = 3048
const DEFAULT_ROWS = 2
const DEFAULT_COLS = 3
const DEFAULT_GAP = 0

const SCHEMA: readonly ParameterSpec[] = [
  { name: 'origin', label: '原点', type: 'point', required: true, defaultValue: DEFAULT_ORIGIN },
  { name: 'plateWidth', label: '幅', type: 'number', required: true, exclusiveMin: 0, unit: 'mm', defaultValue: DEFAULT_PLATE_WIDTH },
  { name: 'plateLength', label: '長さ', type: 'number', required: true, exclusiveMin: 0, unit: 'mm', defaultValue: DEFAULT_PLATE_LENGTH },
  { name: 'rows', label: '行数', type: 'integer', required: true, min: 1, defaultValue: DEFAULT_ROWS },
  { name: 'cols', label: '列数', type: 'integer', required: true, min: 1, defaultValue: DEFAULT_COLS },
  { name: 'gap', label: '間隔', type: 'number', required: false, min: 0, unit: 'mm', defaultValue: DEFAULT_GAP },
]

export const steelPlateArrayDefinition: ParametricObjectDefinition = {
  definitionId: 'steel-plate-array',
  version: 1,
  name: '敷鉄板群',
  category: '仮設',
  description: '敷鉄板を行列状に配置した矩形群',
  parameterSchema: SCHEMA,

  validate(params: ParametricParams): readonly ValidationIssue[] {
    return validateAgainstSchema(SCHEMA, params)
  },

  generate(params: ParametricParams, ctx: GenerationContext): readonly Geometry[] {
    const origin = asPoint(params.origin) ?? DEFAULT_ORIGIN
    const plateWidth = asNumber(params.plateWidth) ?? DEFAULT_PLATE_WIDTH
    const plateLength = asNumber(params.plateLength) ?? DEFAULT_PLATE_LENGTH
    const rows = asInteger(params.rows) ?? DEFAULT_ROWS
    const cols = asInteger(params.cols) ?? DEFAULT_COLS
    const gap = asNumber(params.gap) ?? DEFAULT_GAP

    const plates: Geometry[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const plateOrigin: Point = {
          x: origin.x + c * (plateWidth + gap),
          y: origin.y + r * (plateLength + gap),
        }
        plates.push(makeRectangle(ctx, plateOrigin, plateWidth, plateLength, 0))
      }
    }
    return plates
  },
}
