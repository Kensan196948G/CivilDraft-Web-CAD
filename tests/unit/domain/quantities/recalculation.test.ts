import { describe, expect, it } from 'vitest'
import type { Geometry, GeometryId, QuantityItem, QuantityItemId, RevisionId, RoundingRule } from '@/shared/types'
import { buildQuantityItem, applyManualAdjustment } from '@/domain/quantities/quantityItem'
import {
  buildDependencyIndex,
  invalidateByGeometryChange,
  recomputeQuantityItem,
  recomputeStaleItems,
} from '@/domain/quantities/recalculation'
import { makeLine } from './geometryFixtures'

const REVISION = 'rev-1' as RevisionId
const RULE: RoundingRule = { mode: 'halfUp', decimalPlaces: 2 }

function lengthItem(): QuantityItem {
  const result = buildQuantityItem({
    id: 'q1' as QuantityItemId,
    revisionId: REVISION,
    groupKey: 'g',
    method: 'length',
    unit: 'm',
    roundingRule: RULE,
    geometries: [
      makeLine('l1', { x: 0, y: 0 }, { x: 1000, y: 0 }), // 1.0 m
      makeLine('l2', { x: 0, y: 0 }, { x: 2000, y: 0 }), // 2.0 m
    ],
  })
  if (!result.ok) throw new Error('fixture failed')
  return result.value
}

function lookupFrom(geometries: readonly Geometry[]) {
  const map = new Map<string, Geometry>(geometries.map((geometry) => [geometry.id, geometry]))
  return (id: GeometryId) => map.get(id)
}

describe('buildDependencyIndex / 依存索引（§17.3）', () => {
  it('各根拠図形から明細IDを引ける', () => {
    const index = buildDependencyIndex([lengthItem()])
    expect(index.get('l1' as GeometryId)?.has('q1' as QuantityItemId)).toBe(true)
    expect(index.get('l2' as GeometryId)?.has('q1' as QuantityItemId)).toBe(true)
  })
})

describe('invalidateByGeometryChange / stale化（§17.3・§7.2）', () => {
  it('変更図形を根拠に含む明細を stale にする', () => {
    const invalidated = invalidateByGeometryChange([lengthItem()], ['l1' as GeometryId])
    expect(invalidated[0]?.status).toBe('stale')
  })

  it('無関係な図形の変更では stale にしない', () => {
    const invalidated = invalidateByGeometryChange([lengthItem()], ['other' as GeometryId])
    expect(invalidated[0]?.status).toBe('valid')
  })
})

describe('recomputeQuantityItem / 再計算（§17.3）', () => {
  it('図形が伸びた分だけ値が更新され status=valid に戻る', () => {
    const stale = invalidateByGeometryChange([lengthItem()], ['l1' as GeometryId])[0]!
    const lookup = lookupFrom([
      makeLine('l1', { x: 0, y: 0 }, { x: 4000, y: 0 }), // 1.0 → 4.0 m
      makeLine('l2', { x: 0, y: 0 }, { x: 2000, y: 0 }), // 2.0 m
    ])
    const result = recomputeQuantityItem(stale, lookup)
    expect(result.issues).toHaveLength(0)
    expect(result.item.status).toBe('valid')
    expect(result.item.rawValue).toBeCloseTo(6, 9)
    expect(result.item.roundedValue).toBe(6)
  })

  it('根拠図形が削除されていると status=invalid・Issue を返す', () => {
    const stale = invalidateByGeometryChange([lengthItem()], ['l1' as GeometryId])[0]!
    const lookup = lookupFrom([makeLine('l2', { x: 0, y: 0 }, { x: 2000, y: 0 })]) // l1 欠落
    const result = recomputeQuantityItem(stale, lookup)
    expect(result.item.status).toBe('invalid')
    expect(result.issues[0]?.code).toBe('QTY_SOURCE_MISSING')
  })

  it('手動補正付き明細は roundedValue（人手値）を維持し rawValue のみ更新する', () => {
    const adjusted = applyManualAdjustment(lengthItem(), { adjustedValue: 99, reason: '実測', adjustedBy: '田中', adjustedAt: '2026-07-15T00:00:00Z' })
    if (!adjusted.ok) throw new Error('adjust failed')
    const lookup = lookupFrom([
      makeLine('l1', { x: 0, y: 0 }, { x: 4000, y: 0 }),
      makeLine('l2', { x: 0, y: 0 }, { x: 2000, y: 0 }),
    ])
    const result = recomputeQuantityItem(adjusted.value, lookup)
    expect(result.item.status).toBe('manuallyAdjusted')
    expect(result.item.roundedValue).toBe(99)
    expect(result.item.rawValue).toBeCloseTo(6, 9)
  })
})

describe('recomputeStaleItems / 一括再計算', () => {
  it('stale のみ再計算し valid はそのまま通す', () => {
    const items = invalidateByGeometryChange([lengthItem()], ['l1' as GeometryId])
    const lookup = lookupFrom([
      makeLine('l1', { x: 0, y: 0 }, { x: 1000, y: 0 }),
      makeLine('l2', { x: 0, y: 0 }, { x: 2000, y: 0 }),
    ])
    const result = recomputeStaleItems(items, lookup)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value[0]?.status).toBe('valid')
  })
})
