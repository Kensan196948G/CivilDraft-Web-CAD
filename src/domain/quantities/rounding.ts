/**
 * 数量の丸め処理（詳細設計仕様書 §17.1 RoundingRule / §17.3 丸めの一か所集約）。
 * 浮動小数点誤差を業務表示へ露出させないため、数量の丸めは必ず本モジュールを経由する。
 *
 * 小数桁シフトは `Number(`${v}e${dp}`)` 方式（十進文字列経由）で行い、
 * `v * 10 ** dp` の二進丸め誤差（例: 1.005 * 100 = 100.49999…）を避ける。
 */
import type { RoundingRule } from '@/shared/types'

/** 値を 10^dp 倍する（十進文字列シフトで二進丸め誤差を回避）。 */
function shiftDecimalRight(value: number, decimalPlaces: number): number {
  return Number(`${value}e${decimalPlaces}`)
}

/** 値を 10^dp で割る（十進文字列シフトで二進丸め誤差を回避）。 */
function shiftDecimalLeft(value: number, decimalPlaces: number): number {
  return Number(`${value}e${-decimalPlaces}`)
}

/** 整数へ最近接偶数丸め（銀行家丸め / round-half-to-even）を行う。 */
function roundHalfEvenInteger(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff < 0.5) return floor
  if (diff > 0.5) return floor + 1
  // ちょうど 0.5 → 偶数側へ寄せる（floor の偶奇で分岐）
  return floor % 2 === 0 ? floor : floor + 1
}

/** 整数へ四捨五入（round-half-away-from-zero）を行う。負値は絶対値で丸めてから符号を戻す。 */
function roundHalfAwayFromZeroInteger(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x))
}

/**
 * 丸め規則に従って値を丸める。
 * decimalPlaces が負の場合は 10 の位・100 の位への丸め（例: dp=-1 で 10 単位丸め）を意味する。
 * NaN / Infinity は丸めずそのまま返す（呼び出し側の算出不能を伝播させる）。
 */
export function applyRounding(value: number, rule: RoundingRule): number {
  if (!Number.isFinite(value)) return value
  const scaled = shiftDecimalRight(value, rule.decimalPlaces)

  let roundedInteger: number
  switch (rule.mode) {
    case 'halfUp':
      roundedInteger = roundHalfAwayFromZeroInteger(scaled)
      break
    case 'halfEven':
      roundedInteger = roundHalfEvenInteger(scaled)
      break
    case 'floor':
      roundedInteger = Math.floor(scaled)
      break
    case 'ceil':
      roundedInteger = Math.ceil(scaled)
      break
    case 'truncate':
      roundedInteger = Math.trunc(scaled)
      break
    default: {
      const exhaustive: never = rule.mode
      throw new Error(`未知の丸めモード: ${String(exhaustive)}`)
    }
  }

  // -0 を 0 に正規化する（表示・比較の一貫性のため）。
  const result = shiftDecimalLeft(roundedInteger, rule.decimalPlaces)
  return result === 0 ? 0 : result
}
