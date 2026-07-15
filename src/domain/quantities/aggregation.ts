/**
 * 数量の集計（詳細設計仕様書 §17.3 集計規則）。
 *
 * 工種/種別/細別/規格/工区/測点による任意次元のグルーピング集計を行う。
 * 合計方法は §17.3 の要求どおり 2 通りを明示的に選べる:
 *  - 'sumThenRound': 丸め前値を合計してから集計単位で丸める（既定）。
 *  - 'roundThenSum': 明細丸め後の値を合計する。
 *
 * category/subcategory/workSection/station は QuantityItem に無く CivilAttribute 側にあるため、
 * 集計は明細と属性を対にした AggregatableQuantity を入力に取る。
 * 集計は算出区分(method)と単位(unit)が同一のもの同士でのみ行う（異次元の混算を防ぐため、
 * これらは常にグループ鍵へ含める）。
 */
import type { CivilAttribute, QuantityItem, QuantityMethod, QuantityUnit, RoundingRule } from '@/shared/types'
import { applyRounding } from './rounding'

/** 集計の入力単位。attribute は工区・種別等の集計次元を供給する（欠落可）。 */
export interface AggregatableQuantity {
  readonly item: QuantityItem
  readonly attribute?: CivilAttribute
}

/** 集計次元。属性優先で解決し、無ければ明細側（workType/specification）へフォールバックする。 */
export type QuantityGroupDimension =
  | 'workType'
  | 'category'
  | 'subcategory'
  | 'specification'
  | 'workSection'
  | 'station'

/** 合計方法（§17.3）。 */
export type AggregationMode = 'sumThenRound' | 'roundThenSum'

export interface AggregateOptions {
  readonly dimensions: readonly QuantityGroupDimension[]
  readonly mode?: AggregationMode
  /** sumThenRound 時に用いる丸め規則。未指定ならグループ先頭明細の roundingRule を使う。 */
  readonly roundingRule?: RoundingRule
}

/** 集計結果の 1 グループ。 */
export interface QuantityGroup {
  readonly key: string
  /** 選択した集計次元 → 値（未設定次元は空文字）。 */
  readonly dimensions: Readonly<Record<QuantityGroupDimension, string>>
  readonly method: QuantityMethod
  readonly unit: QuantityUnit
  readonly itemCount: number
  /** stale / invalid の明細数（>0 なら確定不可の警告材料, §17.3）。 */
  readonly staleOrInvalidCount: number
  readonly rawTotal: number
  readonly roundedTotal: number
  readonly items: readonly QuantityItem[]
}

const KEY_SEPARATOR = ''

/** 集計次元の値を属性優先で解決する（未設定は空文字）。 */
function resolveDimension(row: AggregatableQuantity, dimension: QuantityGroupDimension): string {
  const { item, attribute } = row
  switch (dimension) {
    case 'workType':
      return attribute?.workType ?? item.workType ?? ''
    case 'category':
      return attribute?.category ?? ''
    case 'subcategory':
      return attribute?.subcategory ?? ''
    case 'specification':
      return attribute?.specification ?? item.specification ?? ''
    case 'workSection':
      return attribute?.workSectionId ?? ''
    case 'station':
      return attribute?.station ?? ''
    default: {
      const exhaustive: never = dimension
      throw new Error(`未知の集計次元: ${String(exhaustive)}`)
    }
  }
}

interface GroupAccumulator {
  readonly method: QuantityMethod
  readonly unit: QuantityUnit
  readonly dimensions: Record<QuantityGroupDimension, string>
  readonly items: QuantityItem[]
  readonly roundingRule: RoundingRule
}

/**
 * 数量明細を指定次元で集計する（§17.3）。
 * method / unit は常に鍵へ含めるため、同一次元でも算出区分・単位が異なれば別グループになる。
 * 返却順は最初に各グループが出現した順（安定）。
 */
export function aggregateQuantities(
  rows: readonly AggregatableQuantity[],
  options: AggregateOptions,
): QuantityGroup[] {
  const mode: AggregationMode = options.mode ?? 'sumThenRound'
  const order: string[] = []
  const groups = new Map<string, GroupAccumulator>()

  for (const row of rows) {
    const dimensionValues = {} as Record<QuantityGroupDimension, string>
    const keyParts: string[] = []
    for (const dimension of options.dimensions) {
      const value = resolveDimension(row, dimension)
      dimensionValues[dimension] = value
      keyParts.push(`${dimension}=${value}`)
    }
    const key = [...keyParts, `method=${row.item.method}`, `unit=${row.item.unit}`].join(KEY_SEPARATOR)

    const existing = groups.get(key)
    if (existing === undefined) {
      order.push(key)
      groups.set(key, {
        method: row.item.method,
        unit: row.item.unit,
        dimensions: dimensionValues,
        items: [row.item],
        roundingRule: options.roundingRule ?? row.item.roundingRule,
      })
    } else {
      existing.items.push(row.item)
    }
  }

  return order.map((key) => {
    const accumulator = groups.get(key)!
    const rawTotal = accumulator.items.reduce((sum, item) => sum + item.rawValue, 0)
    const roundedTotal =
      mode === 'roundThenSum'
        ? accumulator.items.reduce((sum, item) => sum + item.roundedValue, 0)
        : applyRounding(rawTotal, accumulator.roundingRule)
    const staleOrInvalidCount = accumulator.items.filter(
      (item) => item.status === 'stale' || item.status === 'invalid',
    ).length

    return {
      key,
      dimensions: accumulator.dimensions,
      method: accumulator.method,
      unit: accumulator.unit,
      itemCount: accumulator.items.length,
      staleOrInvalidCount,
      rawTotal,
      roundedTotal,
      items: accumulator.items,
    }
  })
}
