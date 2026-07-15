/**
 * 数量単位（QuantityUnit）と算出区分（QuantityMethod）の整合判定・単位換算（詳細設計仕様書 §17.2）。
 * ADR-0012 の内部基準（長さ=mm、面積=mm²、体積=mm³）から QuantityUnit の表示単位へ変換する際は、
 * 素 number を直接割らず必ず domain/units を経由する（§4.1 単位変換の集約）。
 */
import type { QuantityMethod, QuantityUnit } from '@/shared/types'
import { fromAreaMm2, fromLengthMm, fromVolumeMm3 } from '@/domain/units'

/** 算出区分が扱う物理次元。custom/count/set は無次元系として扱う。 */
export type QuantityDimension = 'length' | 'area' | 'volume' | 'countable'

/**
 * 算出区分が要求する物理次元を返す。
 * length/perimeter=長さ、area=面積、volume=体積、count=個数。
 * manual は次元を固定しない（呼び出し側の単位に従う）ため null を返す。
 */
export function dimensionOfMethod(method: QuantityMethod): QuantityDimension | null {
  switch (method) {
    case 'length':
    case 'perimeter':
      return 'length'
    case 'area':
      return 'area'
    case 'volume':
      return 'volume'
    case 'count':
      return 'countable'
    case 'manual':
      return null
    default: {
      const exhaustive: never = method
      throw new Error(`未知の算出区分: ${String(exhaustive)}`)
    }
  }
}

/**
 * 算出区分と単位が整合するかを判定する（§14「単位」と §17.2「算出」の対応）。
 * custom は任意の算出区分で許容する（マスター外の自由単位の逃げ道）。
 * manual は自動算出しないため任意単位を許容する。
 */
export function isUnitConsistentWithMethod(method: QuantityMethod, unit: QuantityUnit): boolean {
  if (unit === 'custom' || method === 'manual') return true
  const dimension = dimensionOfMethod(method)
  switch (dimension) {
    case 'length':
      return unit === 'm'
    case 'area':
      return unit === 'm2'
    case 'volume':
      return unit === 'm3'
    case 'countable':
      return unit === 'count' || unit === 'set'
    case null:
      return true
    default: {
      const exhaustive: never = dimension
      throw new Error(`未知の次元: ${String(exhaustive)}`)
    }
  }
}

/** 内部基準（mm）の長さを QuantityUnit へ換算する。custom は無次元として素値を維持する。 */
export function lengthMmToUnit(mm: number, unit: QuantityUnit): number {
  return unit === 'm' ? fromLengthMm(mm, 'm').value : mm
}

/** 内部基準（mm²）の面積を QuantityUnit へ換算する。custom は無次元として素値を維持する。 */
export function areaMm2ToUnit(mm2: number, unit: QuantityUnit): number {
  return unit === 'm2' ? fromAreaMm2(mm2, 'm2').value : mm2
}

/** 内部基準（mm³）の体積を QuantityUnit へ換算する。custom は無次元として素値を維持する。 */
export function volumeMm3ToUnit(mm3: number, unit: QuantityUnit): number {
  return unit === 'm3' ? fromVolumeMm3(mm3, 'm3').value : mm3
}
