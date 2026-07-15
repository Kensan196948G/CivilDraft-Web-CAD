import { describe, expect, it } from 'vitest'
import type { CivilAttribute } from '@/shared/types'
import {
  applyCivilAttributePatch,
  applyCivilAttributePatchToMany,
  createAttributeSnapshot,
  deriveGroupKey,
  snapshotDisplayName,
  validateAttributeForQuantity,
  validateCivilAttribute,
} from '@/domain/civil-attributes/civilAttribute'

function attr(overrides: Partial<CivilAttribute> = {}): CivilAttribute {
  return { id: 'a1', tags: [], ...overrides }
}

describe('validateCivilAttribute / 構造検査（§14）', () => {
  it('単位と算出区分が整合すれば問題なし（length + m）', () => {
    expect(validateCivilAttribute(attr({ quantityMethod: 'length', unit: 'm' }))).toEqual([])
  })

  it('欠損は作図時には許容する（issue なし）', () => {
    expect(validateCivilAttribute(attr())).toEqual([])
  })

  it('単位と算出区分の次元不整合はエラー（length + m2）', () => {
    const issues = validateCivilAttribute(attr({ quantityMethod: 'length', unit: 'm2' }))
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe('CIVIL_UNIT_METHOD_MISMATCH')
  })
})

describe('validateAttributeForQuantity / 数量確定時の完全性検査（§14 末尾）', () => {
  it('工種・単位・算出区分が揃えば問題なし', () => {
    expect(validateAttributeForQuantity(attr({ workType: '土工', unit: 'm', quantityMethod: 'length' }))).toEqual([])
  })

  it('工種・単位・算出区分の欠落をすべて列挙する', () => {
    const codes = validateAttributeForQuantity(attr()).map((issue) => issue.code)
    expect(codes).toContain('CIVIL_WORKTYPE_REQUIRED')
    expect(codes).toContain('CIVIL_UNIT_REQUIRED')
    expect(codes).toContain('CIVIL_METHOD_REQUIRED')
  })
})

describe('applyCivilAttributePatch / 一括編集（§14 Patch型）', () => {
  it('Patch に含めたフィールドだけ変更し、他は保持する', () => {
    const before = attr({ workType: '土工', category: '掘削', station: 'No.1' })
    const after = applyCivilAttributePatch(before, { category: '盛土' })
    expect(after.category).toBe('盛土')
    expect(after.workType).toBe('土工')
    expect(after.station).toBe('No.1')
  })

  it('値が undefined のキーは変更しない（変更対象だけを明示）', () => {
    const before = attr({ workType: '土工' })
    const after = applyCivilAttributePatch(before, { workType: undefined, category: '掘削' })
    expect(after.workType).toBe('土工')
    expect(after.category).toBe('掘削')
  })

  it('複数属性へ同一 Patch を適用する', () => {
    const list = [attr({ id: 'a1', workType: '土工' }), attr({ id: 'a2', workType: '舗装' })]
    const patched = applyCivilAttributePatchToMany(list, { workSectionId: 'W-9' })
    expect(patched.every((a) => a.workSectionId === 'W-9')).toBe(true)
    expect(patched[0]?.workType).toBe('土工')
  })
})

describe('deriveGroupKey / 集計鍵導出', () => {
  it('同一分類は同一鍵、規格違いは別鍵になる', () => {
    const a = attr({ workType: '土工', category: '掘削', unit: 'm3', quantityMethod: 'volume', specification: 'A' })
    const b = attr({ workType: '土工', category: '掘削', unit: 'm3', quantityMethod: 'volume', specification: 'A' })
    const c = attr({ workType: '土工', category: '掘削', unit: 'm3', quantityMethod: 'volume', specification: 'B' })
    expect(deriveGroupKey(a)).toBe(deriveGroupKey(b))
    expect(deriveGroupKey(a)).not.toBe(deriveGroupKey(c))
  })
})

describe('snapshotDisplayName / 表示名スナップショット（§14 過去改訂の不変性）', () => {
  it('工種/種別/細別 と規格を1本の表示名へ凍結する', () => {
    const name = snapshotDisplayName(attr({ workType: '土工', category: '掘削', subcategory: '機械掘削', specification: 'BH0.8' }))
    expect(name).toBe('土工 / 掘削 / 機械掘削 [BH0.8]')
  })

  it('分類が空なら (未分類) を返す', () => {
    expect(snapshotDisplayName(attr())).toBe('(未分類)')
  })

  it('スナップショットは属性IDと日時を保持する', () => {
    const snapshot = createAttributeSnapshot(attr({ workType: '土工' }), '2026-07-15T00:00:00Z')
    expect(snapshot).toMatchObject({ attributeId: 'a1', displayName: '土工', snapshotAt: '2026-07-15T00:00:00Z' })
  })
})
