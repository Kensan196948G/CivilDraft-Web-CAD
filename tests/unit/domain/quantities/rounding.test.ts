import { describe, expect, it } from 'vitest'
import { applyRounding } from '@/domain/quantities/rounding'

describe('applyRounding / halfUp（四捨五入・away-from-zero）', () => {
  it('小数2桁で四捨五入する', () => {
    expect(applyRounding(2.345, { mode: 'halfUp', decimalPlaces: 2 })).toBe(2.35)
  })

  it('二進丸め誤差を持つ 1.005 を正しく 1.01 に丸める（十進シフトの検証）', () => {
    expect(applyRounding(1.005, { mode: 'halfUp', decimalPlaces: 2 })).toBe(1.01)
  })

  it('負値はゼロから遠い側へ丸める（-2.5 → -3）', () => {
    expect(applyRounding(-2.5, { mode: 'halfUp', decimalPlaces: 0 })).toBe(-3)
  })
})

describe('applyRounding / halfEven（銀行家丸め）', () => {
  it('0.5 は偶数側へ（2.5 → 2, 3.5 → 4）', () => {
    expect(applyRounding(2.5, { mode: 'halfEven', decimalPlaces: 0 })).toBe(2)
    expect(applyRounding(3.5, { mode: 'halfEven', decimalPlaces: 0 })).toBe(4)
  })

  it('小数2桁でも偶数側へ寄せる（0.125 → 0.12, 0.135 → 0.14）', () => {
    expect(applyRounding(0.125, { mode: 'halfEven', decimalPlaces: 2 })).toBe(0.12)
    expect(applyRounding(0.135, { mode: 'halfEven', decimalPlaces: 2 })).toBe(0.14)
  })
})

describe('applyRounding / floor・ceil・truncate', () => {
  it('floor は下方向へ丸める', () => {
    expect(applyRounding(1.999, { mode: 'floor', decimalPlaces: 1 })).toBe(1.9)
  })

  it('ceil は上方向へ丸める', () => {
    expect(applyRounding(1.001, { mode: 'ceil', decimalPlaces: 1 })).toBe(1.1)
  })

  it('truncate はゼロ方向へ切り捨てる（負値も 0 側）', () => {
    expect(applyRounding(-1.9, { mode: 'truncate', decimalPlaces: 0 })).toBe(-1)
    expect(applyRounding(1.9, { mode: 'truncate', decimalPlaces: 0 })).toBe(1)
  })
})

describe('applyRounding / 退化・境界', () => {
  it('NaN / Infinity は丸めずそのまま返す', () => {
    expect(applyRounding(Number.NaN, { mode: 'halfUp', decimalPlaces: 2 })).toBeNaN()
    expect(applyRounding(Number.POSITIVE_INFINITY, { mode: 'floor', decimalPlaces: 0 })).toBe(Number.POSITIVE_INFINITY)
  })

  it('負の decimalPlaces は 10 の位への丸めになる（1234, dp=-2 → 1200）', () => {
    expect(applyRounding(1234, { mode: 'halfUp', decimalPlaces: -2 })).toBe(1200)
  })

  it('丸め結果の -0 は 0 に正規化される', () => {
    expect(Object.is(applyRounding(-0.4, { mode: 'halfUp', decimalPlaces: 0 }), 0)).toBe(true)
  })
})
