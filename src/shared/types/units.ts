/**
 * 詳細設計仕様書 §4.1 単位付き数値
 * 内部座標基準はADR-0012で確定済み（長さ基準単位=mm、角度基準単位=rad、
 * 許容差は domain/units の EPSILON_LENGTH_MM / EPSILON_ANGLE_RAD を参照）。
 * 基準単位以外との変換は domain/units へ集約し、値だけのnumberを機能間APIで
 * 受け渡さないこと。
 */
export type LengthUnit = 'mm' | 'cm' | 'm'
export type AreaUnit = 'mm2' | 'cm2' | 'm2'
export type VolumeUnit = 'mm3' | 'cm3' | 'm3'
export type AngleUnit = 'deg' | 'rad' | 'gon'

export interface LengthValue {
  readonly value: number
  readonly unit: LengthUnit
}

export interface AreaValue {
  readonly value: number
  readonly unit: AreaUnit
}

export interface VolumeValue {
  readonly value: number
  readonly unit: VolumeUnit
}

export interface AngleValue {
  readonly value: number
  readonly unit: AngleUnit
}
