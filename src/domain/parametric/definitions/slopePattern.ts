/**
 * slope-pattern（法面パターン）— 詳細設計仕様書 §15.1・§16.1。
 * パラメータ: 法肩（crest）・法尻（toe）・勾配（slopeRatio）・記号間隔。
 * 生成物: 法面記号（斜面線＋長短交互の法面ハッチ記号）・注記（勾配表記）。
 * 勾配は §16.1 の parseSlopeRatio で検証し、注記の再現表記に用いる。
 */
import type { Geometry, Point, ValidationIssue } from '@/shared/types'
import type { GenerationContext } from '../generationContext'
import type { ParameterSpec, ParametricObjectDefinition, ParametricParams } from '../parametricTypes'
import { asNumber, asPoint, asString, validateAgainstSchema } from '../parameterValidation'
import { makeLine, makePolyline, makeText, sampleAlongPath } from '../geometryHelpers'
import { parseSlopeRatio } from '../slopeRatio'

const DEFAULT_CREST: Point = { x: 0, y: 0 }
const DEFAULT_TOE: Point = { x: 3000, y: 4000 }
const DEFAULT_SLOPE = '1:0.5'
const DEFAULT_SYMBOL_SPACING = 1000

/** 法面記号の長い爪と短い爪の長さ比（記号間隔に対する係数）。 */
const LONG_TICK_RATIO = 0.6
const SHORT_TICK_RATIO = 0.3

const SCHEMA: readonly ParameterSpec[] = [
  { name: 'crest', label: '法肩', type: 'point', required: true, defaultValue: DEFAULT_CREST },
  { name: 'toe', label: '法尻', type: 'point', required: true, defaultValue: DEFAULT_TOE },
  { name: 'slopeRatio', label: '勾配', type: 'slopeRatio', required: true, defaultValue: DEFAULT_SLOPE },
  { name: 'symbolSpacing', label: '記号間隔', type: 'number', required: true, exclusiveMin: 0, unit: 'mm', defaultValue: DEFAULT_SYMBOL_SPACING },
]

export const slopePatternDefinition: ParametricObjectDefinition = {
  definitionId: 'slope-pattern',
  version: 1,
  name: '法面パターン',
  category: '土工',
  description: '法肩・法尻を結ぶ斜面線と法面記号・勾配注記',
  parameterSchema: SCHEMA,

  validate(params: ParametricParams): readonly ValidationIssue[] {
    const issues = validateAgainstSchema(SCHEMA, params)
    const crest = asPoint(params.crest)
    const toe = asPoint(params.toe)
    if (crest !== undefined && toe !== undefined && crest.x === toe.x && crest.y === toe.y) {
      issues.push({
        code: 'SLOPE_ZERO_LENGTH',
        severity: 'error',
        field: 'toe',
        message: '法肩と法尻は異なる点を指定してください',
      })
    }
    return issues
  },

  generate(params: ParametricParams, ctx: GenerationContext): readonly Geometry[] {
    const crest = asPoint(params.crest) ?? DEFAULT_CREST
    const toe = asPoint(params.toe) ?? DEFAULT_TOE
    const symbolSpacing = asNumber(params.symbolSpacing) ?? DEFAULT_SYMBOL_SPACING
    const slopeText = asString(params.slopeRatio) ?? DEFAULT_SLOPE

    const result: Geometry[] = [makePolyline(ctx, [crest, toe], false)]

    // 法面記号: 斜面線に垂直（左手法線側）へ長短交互の爪を描く。
    const samples = sampleAlongPath([crest, toe], symbolSpacing)
    samples.forEach((sample, index) => {
      const normalRad = ((sample.angleDeg + 90) * Math.PI) / 180
      const tickLength = symbolSpacing * (index % 2 === 0 ? LONG_TICK_RATIO : SHORT_TICK_RATIO)
      const tickEnd: Point = {
        x: sample.point.x + Math.cos(normalRad) * tickLength,
        y: sample.point.y + Math.sin(normalRad) * tickLength,
      }
      result.push(makeLine(ctx, sample.point, tickEnd))
    })

    // 注記: 勾配表記（parse 成功時は再現表記、失敗時は入力そのまま）。
    const parsed = parseSlopeRatio(slopeText)
    const display = parsed.ok ? parsed.value.display : slopeText
    const mid: Point = { x: (crest.x + toe.x) / 2, y: (crest.y + toe.y) / 2 }
    result.push(makeText(ctx, { x: mid.x + 300, y: mid.y }, display, { horizontalAlign: 'left' }))

    return result
  },
}
