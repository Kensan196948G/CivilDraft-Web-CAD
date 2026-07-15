/**
 * 簡易土量計算（平均断面法, 詳細設計仕様書 §16.3）。
 *
 *   V = (A1 + A2) / 2 × L
 *
 * - 切土・盛土を別々に計算する。
 * - 根拠として、断面間距離 L・対象断面 ID・採用式（method）・丸め前値（volume）を保持する。
 * - 中間断面の急変（不等辺・湾曲）を自動判断しないため、常に「簡易計算である」旨の warning を付す。
 *   利用者はこの限界を理解した上で採用値を判断する（§16.3「簡易計算であることを表示する」）。
 *
 * 単位: 面積 mm²・距離 mm → 体積 mm³（ADR-0012: 内部座標基準）。
 */
import type { Result, ValidationIssue } from '@/shared/types'
import type { Section } from './section'
import { computeSectionAreas } from './sectionArea'

/** 採用した土量計算式。現状は平均断面法のみ。 */
export type EarthworkMethod = 'averageEndArea'

/** 1 種別（切土 or 盛土）の土量計算結果と根拠。 */
export interface VolumeComputation {
  /** 採用式。 */
  readonly method: EarthworkMethod
  /** 始点側断面積 A1（mm²、丸め前）。 */
  readonly area1: number
  /** 終点側断面積 A2（mm²、丸め前）。 */
  readonly area2: number
  /** 断面間距離 L（mm）。 */
  readonly distance: number
  /** 体積 V（mm³、丸め前値）。 */
  readonly volume: number
}

/** 2 断面間の切土・盛土土量（平均断面法）。 */
export interface EarthworkVolume {
  /** 始点側断面 ID（対象断面の根拠）。 */
  readonly fromSectionId: string
  /** 終点側断面 ID（対象断面の根拠）。 */
  readonly toSectionId: string
  /** 断面間距離 L（mm）= |測点差|。 */
  readonly distance: number
  readonly cut: VolumeComputation
  readonly fill: VolumeComputation
  /** 簡易計算である旨、および算出過程の注意。 */
  readonly warnings: readonly ValidationIssue[]
}

/**
 * 平均断面法の素の計算式 V=(A1+A2)/2×L。検証は行わない純関数（呼び出し側で入力を保証）。
 */
export function averageEndAreaVolume(area1: number, area2: number, distance: number): number {
  return ((area1 + area2) / 2) * distance
}

/**
 * 平均断面法で 1 種別の土量を算出する。距離・面積の妥当性を検証する。
 * 距離 L は正の有限数、面積は 0 以上の有限数を要求する。
 */
export function computeAverageEndArea(
  area1: number,
  area2: number,
  distance: number,
): Result<VolumeComputation, ValidationIssue> {
  if (!Number.isFinite(distance) || distance <= 0) {
    return {
      ok: false,
      error: {
        code: 'EARTHWORK_INVALID_DISTANCE',
        severity: 'error',
        field: 'distance',
        message: `断面間距離は正の有限数である必要があります: ${String(distance)}`,
      },
    }
  }
  if (!Number.isFinite(area1) || !Number.isFinite(area2) || area1 < 0 || area2 < 0) {
    return {
      ok: false,
      error: {
        code: 'EARTHWORK_INVALID_AREA',
        severity: 'error',
        message: `断面積は 0 以上の有限数である必要があります: A1=${String(area1)}, A2=${String(area2)}`,
      },
    }
  }
  return {
    ok: true,
    value: {
      method: 'averageEndArea',
      area1,
      area2,
      distance,
      volume: averageEndAreaVolume(area1, area2, distance),
    },
  }
}

/**
 * 隣接 2 断面間の切土・盛土土量を平均断面法で算出する。
 * 各断面の面積は computeSectionAreas で導出する（キャッシュ cutArea/fillArea には依存しない）。
 * いずれかの断面が面積未確定、または距離が 0 の場合は ok:false で理由を返す。
 * @param from 始点側断面（station が小さい側を推奨するが順序は問わない）。
 * @param to 終点側断面。
 */
export function computeEarthworkVolume(
  from: Section,
  to: Section,
): Result<EarthworkVolume, readonly ValidationIssue[]> {
  const fromAreas = computeSectionAreas(from)
  if (!fromAreas.ok) return { ok: false, error: fromAreas.error }
  const toAreas = computeSectionAreas(to)
  if (!toAreas.ok) return { ok: false, error: toAreas.error }

  const distance = Math.abs(to.station - from.station)

  const cut = computeAverageEndArea(fromAreas.value.cutArea, toAreas.value.cutArea, distance)
  if (!cut.ok) return { ok: false, error: [cut.error] }
  const fill = computeAverageEndArea(fromAreas.value.fillArea, toAreas.value.fillArea, distance)
  if (!fill.ok) return { ok: false, error: [fill.error] }

  const warnings: ValidationIssue[] = [
    {
      code: 'EARTHWORK_SIMPLIFIED_METHOD',
      severity: 'info',
      message:
        '平均断面法による簡易土量です。中間断面の急変（不等辺・湾曲）は考慮していません（§16.3）',
    },
  ]

  return {
    ok: true,
    value: {
      fromSectionId: from.id,
      toSectionId: to.id,
      distance,
      cut: cut.value,
      fill: fill.value,
      warnings,
    },
  }
}
