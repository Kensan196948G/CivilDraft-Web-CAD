import { describe, expect, it } from 'vitest'
import type {
  CivilAttribute,
  QuantityItem,
  QuantityItemId,
  QuantityMethod,
  QuantityUnit,
  RevisionId,
  RoundingRule,
} from '@/shared/types'
import { aggregateQuantities } from '@/domain/quantities/aggregation'

const REVISION = 'rev-1' as RevisionId
const RULE: RoundingRule = { mode: 'halfUp', decimalPlaces: 2 }

interface ItemOverrides {
  readonly id: string
  readonly rawValue: number
  readonly roundedValue: number
  readonly method?: QuantityMethod
  readonly unit?: QuantityUnit
  readonly workType?: string
  readonly status?: QuantityItem['status']
}

function item(overrides: ItemOverrides): QuantityItem {
  return {
    id: overrides.id as QuantityItemId,
    revisionId: REVISION,
    groupKey: 'g',
    workType: overrides.workType,
    method: overrides.method ?? 'length',
    unit: overrides.unit ?? 'm',
    rawValue: overrides.rawValue,
    roundedValue: overrides.roundedValue,
    roundingRule: RULE,
    sources: [],
    status: overrides.status ?? 'valid',
  }
}

describe('aggregateQuantities / 次元グルーピング（§17.3）', () => {
  it('工種で合算する', () => {
    const groups = aggregateQuantities(
      [
        { item: item({ id: 'q1', rawValue: 1, roundedValue: 1, workType: '土工' }) },
        { item: item({ id: 'q2', rawValue: 2, roundedValue: 2, workType: '土工' }) },
      ],
      { dimensions: ['workType'] },
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.dimensions.workType).toBe('土工')
    expect(groups[0]?.rawTotal).toBeCloseTo(3, 9)
    expect(groups[0]?.roundedTotal).toBe(3)
    expect(groups[0]?.itemCount).toBe(2)
  })

  it('属性側の種別（category）で集計できる', () => {
    const attr: CivilAttribute = { id: 'a1', category: '掘削', tags: [] }
    const groups = aggregateQuantities(
      [
        { item: item({ id: 'q1', rawValue: 1, roundedValue: 1 }), attribute: attr },
        { item: item({ id: 'q2', rawValue: 4, roundedValue: 4 }), attribute: attr },
      ],
      { dimensions: ['category'] },
    )
    expect(groups[0]?.dimensions.category).toBe('掘削')
    expect(groups[0]?.rawTotal).toBeCloseTo(5, 9)
  })

  it('sumThenRound と roundThenSum で結果が変わる', () => {
    const rows = [
      { item: item({ id: 'q1', rawValue: 1.004, roundedValue: 1.0, workType: '土工' }) },
      { item: item({ id: 'q2', rawValue: 1.004, roundedValue: 1.0, workType: '土工' }) },
    ]
    const sumThenRound = aggregateQuantities(rows, { dimensions: ['workType'], mode: 'sumThenRound' })
    const roundThenSum = aggregateQuantities(rows, { dimensions: ['workType'], mode: 'roundThenSum' })
    expect(sumThenRound[0]?.roundedTotal).toBe(2.01) // 2.008 を丸め
    expect(roundThenSum[0]?.roundedTotal).toBe(2.0) // 1.00 + 1.00
  })

  it('同一工種でも算出区分・単位が異なれば別グループになる', () => {
    const groups = aggregateQuantities(
      [
        { item: item({ id: 'q1', rawValue: 1, roundedValue: 1, workType: '土工', method: 'length', unit: 'm' }) },
        { item: item({ id: 'q2', rawValue: 2, roundedValue: 2, workType: '土工', method: 'area', unit: 'm2' }) },
      ],
      { dimensions: ['workType'] },
    )
    expect(groups).toHaveLength(2)
  })

  it('stale / invalid の明細数を集計する（確定不可の警告材料）', () => {
    const groups = aggregateQuantities(
      [
        { item: item({ id: 'q1', rawValue: 1, roundedValue: 1, workType: '土工', status: 'stale' }) },
        { item: item({ id: 'q2', rawValue: 2, roundedValue: 2, workType: '土工', status: 'valid' }) },
      ],
      { dimensions: ['workType'] },
    )
    expect(groups[0]?.staleOrInvalidCount).toBe(1)
  })
})
