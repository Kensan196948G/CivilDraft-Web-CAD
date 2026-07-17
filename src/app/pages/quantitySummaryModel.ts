import { computeContribution } from '@/domain/quantities/quantityCalculator'
import { buildQuantityItem } from '@/domain/quantities/quantityItem'
import { applyRounding } from '@/domain/quantities/rounding'
import type { QuantityCsvContext } from '@/domain/quantities/quantityCsv'
import type {
  Geometry,
  QuantityItem,
  QuantityItemId,
  QuantityMethod,
  QuantityUnit,
  RevisionId,
  RoundingRule,
  ValidationIssue,
} from '@/shared/types'

/** 数量表示の既定丸め規則（土木の一般的表示として小数2桁・四捨五入, §17.2）。 */
export const DEFAULT_ROUNDING_RULE: RoundingRule = { mode: 'halfUp', decimalPlaces: 2 }

/**
 * 現図面から算出する明細に付す改訂ID。確定改訂ではなく「現在の作業中図面」を指すため
 * プレースホルダとする（確定版の数量は別途 revisions ドメインが発番する）。
 */
const CURRENT_REVISION_ID = 'current' as RevisionId

/**
 * 案件レベルの列（§24.2）。案件管理が未結線のため空。結線後に親が供給する。
 * 空でも exportQuantityCsv の列順・インジェクション対策には影響しない。
 */
export const CSV_CONTEXT: QuantityCsvContext = {
  projectNumber: '',
  drawingNumber: '',
  revisionNumber: '',
}

/** 図形 type から推定した既定の算出区分と単位。 */
export interface QuantitySpec {
  readonly method: QuantityMethod
  readonly unit: QuantityUnit
}

/**
 * 属性未付与図形の既定算出区分を図形 type から推定する（設計判断）。
 * 注記系（text/dimension/leader）は数量対象外として null を返す。
 */
export function deriveDefaultQuantitySpec(geometry: Geometry): QuantitySpec | null {
  switch (geometry.type) {
    case 'line':
    case 'arc':
    case 'spline':
      return { method: 'length', unit: 'm' }
    case 'polyline':
      return geometry.closed ? { method: 'area', unit: 'm2' } : { method: 'length', unit: 'm' }
    case 'circle':
    case 'rectangle':
    case 'ellipse':
    case 'hatch':
      return { method: 'area', unit: 'm2' }
    case 'symbol':
    case 'parametricObject':
      return { method: 'count', unit: 'count' }
    case 'text':
    case 'dimension':
    case 'leader':
      return null
    default: {
      const exhaustive: never = geometry
      throw new Error(`未知の図形種別: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** 算出結果。items は算出区分×単位でまとめた明細、issues は算出不能図形の理由。 */
export interface QuantitySummary {
  readonly items: readonly QuantityItem[]
  readonly issues: readonly ValidationIssue[]
  /** 数量対象外（注記系）としてスキップした図形数。 */
  readonly skippedCount: number
}

interface SpecGroup {
  readonly method: QuantityMethod
  readonly unit: QuantityUnit
  readonly geometries: Geometry[]
}

/**
 * 現図面の geometries から数量明細を算出する（§17.2 算出 / §17.3 sum-then-round）。
 */
export function computeQuantitySummary(geometries: readonly Geometry[]): QuantitySummary {
  const issues: ValidationIssue[] = []
  let skippedCount = 0
  const order: string[] = []
  const groups = new Map<string, SpecGroup>()

  for (const geometry of geometries) {
    const spec = deriveDefaultQuantitySpec(geometry)
    if (spec === null) {
      skippedCount += 1
      continue
    }
    const contribution = computeContribution(geometry, spec.method, spec.unit)
    if (!contribution.ok) {
      issues.push(contribution.error)
      continue
    }
    const key = `${spec.method}|${spec.unit}`
    const existing = groups.get(key)
    if (existing === undefined) {
      order.push(key)
      groups.set(key, { method: spec.method, unit: spec.unit, geometries: [geometry] })
    } else {
      existing.geometries.push(geometry)
    }
  }

  const items: QuantityItem[] = []
  for (const key of order) {
    const group = groups.get(key)!
    const result = buildQuantityItem({
      id: `qty-${key}` as QuantityItemId,
      revisionId: CURRENT_REVISION_ID,
      groupKey: key,
      method: group.method,
      unit: group.unit,
      roundingRule: DEFAULT_ROUNDING_RULE,
      geometries: group.geometries,
    })
    if (result.ok) items.push(result.value)
    else issues.push(...result.error)
  }

  return { items, issues, skippedCount }
}

/** 数値の表示整形（内容は変えない素の文字列化）。丸め前値・表示値の双方に用いる。 */
export function formatQuantity(value: number): string {
  return Number.isFinite(value) ? String(value) : '—'
}

/** 単位別に表示値（roundedValue）を合計し、既定規則で再度丸めて浮動小数誤差を抑える。 */
export function totalRoundedByUnit(items: readonly QuantityItem[], unit: QuantityUnit): number {
  const sum = items
    .filter((item) => item.unit === unit)
    .reduce((acc, item) => acc + item.roundedValue, 0)
  return applyRounding(sum, DEFAULT_ROUNDING_RULE)
}
