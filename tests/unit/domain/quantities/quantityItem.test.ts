import { describe, expect, it } from 'vitest'
import type { QuantityItemId, RevisionId, RoundingRule } from '@/shared/types'
import {
  applyManualAdjustment,
  buildManualQuantityItem,
  buildQuantityItem,
  revertManualAdjustment,
} from '@/domain/quantities/quantityItem'
import { makeCircle, makeLine } from './geometryFixtures'

const REVISION = 'rev-1' as RevisionId
const RULE: RoundingRule = { mode: 'halfUp', decimalPlaces: 2 }

describe('buildQuantityItem / 複数図形の合算（§17.3 sum-then-round）', () => {
  it('2線分の延長を合算して丸める（1.234m + 2.345m → raw 3.579, rounded 3.58）', () => {
    const result = buildQuantityItem({
      id: 'q1' as QuantityItemId,
      revisionId: REVISION,
      groupKey: 'g',
      method: 'length',
      unit: 'm',
      roundingRule: RULE,
      geometries: [
        makeLine('l1', { x: 0, y: 0 }, { x: 1234, y: 0 }),
        makeLine('l2', { x: 0, y: 0 }, { x: 2345, y: 0 }),
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.rawValue).toBeCloseTo(3.579, 9)
    expect(result.value.roundedValue).toBe(3.58)
    expect(result.value.status).toBe('valid')
    expect(result.value.sources).toHaveLength(2)
    expect(result.value.sources[0]?.contributionRaw).toBeCloseTo(1.234, 9)
  })

  it('method=manual は buildQuantityItem では扱えずエラー', () => {
    const result = buildQuantityItem({
      id: 'q1' as QuantityItemId,
      revisionId: REVISION,
      groupKey: 'g',
      method: 'manual',
      unit: 'm',
      roundingRule: RULE,
      geometries: [makeLine('l1', { x: 0, y: 0 }, { x: 1000, y: 0 })],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error[0]?.code).toBe('QTY_MANUAL_BUILD_UNSUPPORTED')
  })

  it('根拠図形ゼロはエラー', () => {
    const result = buildQuantityItem({
      id: 'q1' as QuantityItemId,
      revisionId: REVISION,
      groupKey: 'g',
      method: 'length',
      unit: 'm',
      roundingRule: RULE,
      geometries: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error[0]?.code).toBe('QTY_NO_SOURCE')
  })

  it('算出不能な図形が混ざると全 Issue を集約してエラー', () => {
    const result = buildQuantityItem({
      id: 'q1' as QuantityItemId,
      revisionId: REVISION,
      groupKey: 'g',
      method: 'length',
      unit: 'm',
      roundingRule: RULE,
      geometries: [makeCircle('c1', { x: 0, y: 0 }, 1000)],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error[0]?.code).toBe('QTY_LENGTH_UNSUPPORTED')
  })
})

function autoItem() {
  const result = buildQuantityItem({
    id: 'q1' as QuantityItemId,
    revisionId: REVISION,
    groupKey: 'g',
    method: 'length',
    unit: 'm',
    roundingRule: RULE,
    geometries: [makeLine('l1', { x: 0, y: 0 }, { x: 5000, y: 0 })], // 5.0 m
  })
  if (!result.ok) throw new Error('fixture build failed')
  return result.value
}

describe('applyManualAdjustment / 手動補正（§17.4）', () => {
  it('理由が空ならエラー（自動値は変更しない）', () => {
    const result = applyManualAdjustment(autoItem(), { adjustedValue: 4.8, reason: '  ', adjustedBy: '田中', adjustedAt: '2026-07-15T00:00:00Z' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('QTY_ADJUSTMENT_REASON_REQUIRED')
  })

  it('実施者が空ならエラー', () => {
    const result = applyManualAdjustment(autoItem(), { adjustedValue: 4.8, reason: '現地実測', adjustedBy: '', adjustedAt: '2026-07-15T00:00:00Z' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('QTY_ADJUSTMENT_ACTOR_REQUIRED')
  })

  it('補正成功時は自動値を originalValue に退避し rawValue を温存する', () => {
    const result = applyManualAdjustment(autoItem(), { adjustedValue: 4.8, reason: '現地実測差', adjustedBy: '田中', adjustedAt: '2026-07-15T00:00:00Z' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('manuallyAdjusted')
    expect(result.value.roundedValue).toBe(4.8)
    expect(result.value.rawValue).toBeCloseTo(5, 9)
    expect(result.value.manualAdjustment?.originalValue).toBe(5)
    expect(result.value.manualAdjustment?.reason).toBe('現地実測差')
  })

  it('補正を取り消すと自動値へ戻る（rawValue から再丸め・status=valid）', () => {
    const adjusted = applyManualAdjustment(autoItem(), { adjustedValue: 4.8, reason: '差', adjustedBy: '田中', adjustedAt: '2026-07-15T00:00:00Z' })
    if (!adjusted.ok) throw new Error('adjust failed')
    const reverted = revertManualAdjustment(adjusted.value)
    expect(reverted.status).toBe('valid')
    expect(reverted.roundedValue).toBe(5)
    expect(reverted.manualAdjustment).toBeUndefined()
  })
})

describe('buildManualQuantityItem / 純手動明細（§17.2 manual）', () => {
  it('理由・実施者・日時があれば method=manual の明細を作る（sources 空）', () => {
    const result = buildManualQuantityItem({
      id: 'q9' as QuantityItemId,
      revisionId: REVISION,
      groupKey: 'g',
      unit: 'm3',
      roundingRule: RULE,
      adjustment: { adjustedValue: 12.5, reason: '断面間土量の別途計算', adjustedBy: '佐藤', adjustedAt: '2026-07-15T00:00:00Z' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.method).toBe('manual')
    expect(result.value.sources).toHaveLength(0)
    expect(result.value.roundedValue).toBe(12.5)
    expect(result.value.status).toBe('manuallyAdjusted')
  })

  it('理由欠落はエラー', () => {
    const result = buildManualQuantityItem({
      id: 'q9' as QuantityItemId,
      revisionId: REVISION,
      groupKey: 'g',
      unit: 'm3',
      roundingRule: RULE,
      adjustment: { adjustedValue: 12.5, reason: '', adjustedBy: '佐藤', adjustedAt: '2026-07-15T00:00:00Z' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('QTY_ADJUSTMENT_REASON_REQUIRED')
  })
})
