import { describe, expect, it } from 'vitest'
import {
  EPSILON_ANGLE_RAD,
  EPSILON_LENGTH_MM,
  formatAreaMm2,
  formatLengthMm,
  fromAngleRad,
  fromAreaMm2,
  fromLengthMm,
  fromVolumeMm3,
  toAngleRad,
  toAreaMm2,
  toLengthMm,
  toVolumeMm3,
} from '@/domain/units'

describe('ADR-0012 内部座標基準 / 長さ（基準単位=mm）', () => {
  it('cm・mを内部基準単位mmへ正しく変換する', () => {
    expect(toLengthMm({ value: 1, unit: 'cm' })).toBe(10)
    expect(toLengthMm({ value: 1, unit: 'm' })).toBe(1000)
    expect(toLengthMm({ value: 1500, unit: 'mm' })).toBe(1500)
  })

  it('mm→他単位→mmの往復変換で元の値に戻る', () => {
    const originalMm = 12345.678
    for (const unit of ['mm', 'cm', 'm'] as const) {
      const converted = fromLengthMm(originalMm, unit)
      expect(toLengthMm(converted)).toBeCloseTo(originalMm, 9)
    }
  })
})

describe('ADR-0012 内部座標基準 / 面積（基準単位=mm2）', () => {
  it('cm2・m2を内部基準単位mm2へ正しく変換する', () => {
    expect(toAreaMm2({ value: 1, unit: 'cm2' })).toBe(100)
    expect(toAreaMm2({ value: 1, unit: 'm2' })).toBe(1_000_000)
  })

  it('mm2→他単位→mm2の往復変換で元の値に戻る', () => {
    const originalMm2 = 987_654.321
    for (const unit of ['mm2', 'cm2', 'm2'] as const) {
      const converted = fromAreaMm2(originalMm2, unit)
      expect(toAreaMm2(converted)).toBeCloseTo(originalMm2, 6)
    }
  })
})

describe('ADR-0012 内部座標基準 / 体積（基準単位=mm3）', () => {
  it('cm3・m3を内部基準単位mm3へ正しく変換する', () => {
    expect(toVolumeMm3({ value: 1, unit: 'cm3' })).toBe(1000)
    expect(toVolumeMm3({ value: 1, unit: 'm3' })).toBe(1_000_000_000)
  })

  it('mm3→他単位→mm3の往復変換で元の値に戻る', () => {
    const originalMm3 = 42_000_000
    for (const unit of ['mm3', 'cm3', 'm3'] as const) {
      const converted = fromVolumeMm3(originalMm3, unit)
      expect(toVolumeMm3(converted)).toBeCloseTo(originalMm3, 3)
    }
  })
})

describe('ADR-0012 内部座標基準 / 角度（基準単位=rad、X軸正方向=0・反時計回りが正）', () => {
  it('degを内部基準単位radへ正しく変換する（Civil-Draw shapeTransform.tsの実害パターンの再発防止）', () => {
    // 継承元(Civil-Draw src/utils/shapeTransform.ts)は (s.startAngle * 180) / Math.PI を
    // 個別に書いていた。domain/unitsに集約した変換が同じ結果を返すことを確認する。
    expect(toAngleRad({ value: 180, unit: 'deg' })).toBeCloseTo(Math.PI, 12)
    expect(toAngleRad({ value: 90, unit: 'deg' })).toBeCloseTo(Math.PI / 2, 12)
  })

  it('gonを内部基準単位radへ正しく変換する（100gon=直角）', () => {
    expect(toAngleRad({ value: 100, unit: 'gon' })).toBeCloseTo(Math.PI / 2, 12)
    expect(toAngleRad({ value: 400, unit: 'gon' })).toBeCloseTo(2 * Math.PI, 12)
  })

  it('rad→他単位→radの往復変換で元の値に戻る', () => {
    const originalRad = Math.PI / 3
    for (const unit of ['rad', 'deg', 'gon'] as const) {
      const converted = fromAngleRad(originalRad, unit)
      expect(toAngleRad(converted)).toBeCloseTo(originalRad, 12)
    }
  })
})

describe('ADR-0012 内部座標基準 / 許容差', () => {
  it('距離比較の許容差は1e-6mm、角度比較の許容差は1e-9radである', () => {
    expect(EPSILON_LENGTH_MM).toBe(1e-6)
    expect(EPSILON_ANGLE_RAD).toBe(1e-9)
  })
})

describe('formatLengthMm', () => {
  it('1000mm未満はmm表記で表示する', () => {
    expect(formatLengthMm(0)).toBe('0.0 mm')
    expect(formatLengthMm(35)).toBe('35.0 mm')
    expect(formatLengthMm(999.9)).toBe('999.9 mm')
  })

  it('1000mm以上はm表記で表示する', () => {
    expect(formatLengthMm(1000)).toBe('1.000 m')
    expect(formatLengthMm(3500)).toBe('3.500 m')
    expect(formatLengthMm(100000)).toBe('100.000 m')
  })

  it('縮尺適用済み寸法の例（1/100縮尺、紙面35mm=実寸3.5m）', () => {
    expect(formatLengthMm(35 * 100)).toBe('3.500 m')
  })
})

describe('formatAreaMm2', () => {
  it('1,000,000mm2未満はmm2表記で表示する', () => {
    expect(formatAreaMm2(600)).toBe('600.0 mm²')
    expect(formatAreaMm2(999999)).toBe('999999.0 mm²')
  })

  it('1,000,000mm2以上はm2表記で表示する', () => {
    expect(formatAreaMm2(1_000_000)).toBe('1.0000 m²')
    expect(formatAreaMm2(1_500_000)).toBe('1.5000 m²')
  })
})
