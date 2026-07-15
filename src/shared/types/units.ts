/**
 * 詳細設計仕様書 §4.1 単位付き数値
 * 基準単位はPhase 1詳細レビューで確定する。変換はdomain/unitsへ集約し、
 * 値だけのnumberを機能間APIで受け渡さないこと。
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
