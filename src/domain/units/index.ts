/**
 * ADR-0012 内部座標基準の変換ロジック。
 * 基準単位: 長さ=mm、面積=mm2、体積=mm3、角度=rad（X軸正方向=0、反時計回りが正）。
 * 単位付き値をここを介さずに素のnumberへ変換しないこと（詳細設計仕様書§4.1）。
 */
import type {
  AngleUnit,
  AngleValue,
  AreaUnit,
  AreaValue,
  LengthUnit,
  LengthValue,
  VolumeUnit,
  VolumeValue,
} from '@/shared/types'

/** ADR-0012: 距離比較の許容差（内部基準単位mmでの差分） */
export const EPSILON_LENGTH_MM = 1e-6

/** ADR-0012: 角度比較の許容差（内部基準単位radでの差分） */
export const EPSILON_ANGLE_RAD = 1e-9

const MM_PER_LENGTH_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
}

const MM2_PER_AREA_UNIT: Record<AreaUnit, number> = {
  mm2: 1,
  cm2: 100,
  m2: 1_000_000,
}

const MM3_PER_VOLUME_UNIT: Record<VolumeUnit, number> = {
  mm3: 1,
  cm3: 1000,
  m3: 1_000_000_000,
}

const RAD_PER_ANGLE_UNIT: Record<AngleUnit, number> = {
  rad: 1,
  deg: Math.PI / 180,
  gon: Math.PI / 200,
}

/** 長さを内部基準単位（mm）の素numberへ変換する */
export function toLengthMm(value: LengthValue): number {
  return value.value * MM_PER_LENGTH_UNIT[value.unit]
}

/** 内部基準単位（mm）の素numberを指定単位のLengthValueへ変換する */
export function fromLengthMm(mm: number, unit: LengthUnit): LengthValue {
  return { value: mm / MM_PER_LENGTH_UNIT[unit], unit }
}

/** 面積を内部基準単位（mm2）の素numberへ変換する */
export function toAreaMm2(value: AreaValue): number {
  return value.value * MM2_PER_AREA_UNIT[value.unit]
}

/** 内部基準単位（mm2）の素numberを指定単位のAreaValueへ変換する */
export function fromAreaMm2(mm2: number, unit: AreaUnit): AreaValue {
  return { value: mm2 / MM2_PER_AREA_UNIT[unit], unit }
}

/** 体積を内部基準単位（mm3）の素numberへ変換する */
export function toVolumeMm3(value: VolumeValue): number {
  return value.value * MM3_PER_VOLUME_UNIT[value.unit]
}

/** 内部基準単位（mm3）の素numberを指定単位のVolumeValueへ変換する */
export function fromVolumeMm3(mm3: number, unit: VolumeUnit): VolumeValue {
  return { value: mm3 / MM3_PER_VOLUME_UNIT[unit], unit }
}

/** 角度を内部基準単位（rad）の素numberへ変換する */
export function toAngleRad(value: AngleValue): number {
  return value.value * RAD_PER_ANGLE_UNIT[value.unit]
}

/** 内部基準単位（rad）の素numberを指定単位のAngleValueへ変換する */
export function fromAngleRad(rad: number, unit: AngleUnit): AngleValue {
  return { value: rad / RAD_PER_ANGLE_UNIT[unit], unit }
}

/** 長さ（mm基準）を人間可読な文字列へ整形する（1000mm以上はm表記に切り替える） */
export function formatLengthMm(mm: number): string {
  return mm >= 1000 ? `${(mm / 1000).toFixed(3)} m` : `${mm.toFixed(1)} mm`
}

/** 面積（mm2基準）を人間可読な文字列へ整形する（1,000,000mm2以上はm2表記に切り替える） */
export function formatAreaMm2(mm2: number): string {
  return mm2 >= 1_000_000 ? `${(mm2 / 1_000_000).toFixed(4)} m²` : `${mm2.toFixed(1)} mm²`
}
