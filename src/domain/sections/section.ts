/**
 * 断面（横断面）のデータモデルと断面線の検証（詳細設計仕様書 §16.2）。
 *
 * 座標規約（offset の符号）:
 * - `offset` は中心線（進行方向）に対する横断方向の位置。**左を負・右を正**で統一する
 *   （詳細設計仕様書 §16.2「規約を明記して統一する」に対する本実装の採用規約）。
 * - `elevation` は標高（上が正）。内部図形座標系（ADR-0012: X右/Y下）とは軸向きが異なるため、
 *   図形生成時は sectionGeometry.ts で elevation の符号を反転して Point.y へ写像する。
 * - 断面線（existingGround / plannedGround）は offset の**狭義単調増加**（左→右）で与える。
 *   標高は offset の関数として扱い、同一 offset の重複や逆行は面積未確定（下記検証）とする。
 */
import type { SurveyPointId, ValidationIssue } from '@/shared/types'

/** 断面線を構成する 1 点（横断位置 offset・標高 elevation、いずれも mm）。 */
export interface SectionPoint {
  readonly offset: number
  readonly elevation: number
}

/**
 * 1 測点の横断面（詳細設計仕様書 §16.2）。
 * cutArea / fillArea は算出結果のキャッシュ（表示用ヒント）で、未確定時は undefined。
 * 正本は existingGround / plannedGround の点列であり、面積は computeSectionAreas で導出する。
 */
export interface Section {
  readonly id: string
  readonly surveyPointId: SurveyPointId
  readonly station: number
  readonly existingGround: readonly SectionPoint[]
  readonly plannedGround: readonly SectionPoint[]
  readonly cutArea?: number
  readonly fillArea?: number
}

/**
 * 断面線 1 本を検証し、面積未確定となる条件（詳細設計仕様書 §16.2）を ValidationIssue で返す。
 * 空配列（issue 無し）なら面積算出可能。検出条件は以下の 3 つ + 非有限値の防御:
 * - 線分不足: 点が 2 未満（線分を構成できない）。
 * - 同一 offset 重複: 隣接点の offset が一致（標高が offset の関数にならない）。
 * - 自己交差: offset が逆行（左→右の単調性が崩れ、線が自己交差し得る）。
 * @param field 発生源を示すフィールド名（'existingGround' | 'plannedGround'）。
 */
export function validateProfile(
  points: readonly SectionPoint[],
  field: 'existingGround' | 'plannedGround',
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (points.length < 2) {
    issues.push({
      code: 'SECTION_PROFILE_TOO_FEW_POINTS',
      severity: 'error',
      field,
      message: `${field}: 断面線には 2 点以上が必要です（線分不足）。現在 ${points.length} 点`,
    })
    return issues
  }

  for (const p of points) {
    if (!Number.isFinite(p.offset) || !Number.isFinite(p.elevation)) {
      issues.push({
        code: 'SECTION_PROFILE_NON_FINITE',
        severity: 'error',
        field,
        message: `${field}: offset / elevation は有限数である必要があります（offset=${p.offset}, elevation=${p.elevation}）`,
      })
      return issues
    }
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    if (b.offset === a.offset) {
      issues.push({
        code: 'SECTION_PROFILE_DUPLICATE_OFFSET',
        severity: 'error',
        field,
        message: `${field}: offset が重複しています（同一 offset=${a.offset}）。断面線は offset の狭義単調増加が必要です`,
      })
    } else if (b.offset < a.offset) {
      issues.push({
        code: 'SECTION_PROFILE_SELF_INTERSECTION',
        severity: 'error',
        field,
        message: `${field}: offset が逆行しています（${a.offset} → ${b.offset}）。自己交差の可能性があり面積未確定です`,
      })
    }
  }

  return issues
}

/**
 * 狭義単調増加の断面線上で、指定 offset における標高を線形補間で求める。
 * 呼び出し側は offset が [points[0].offset, points[last].offset] に収まることを保証する
 * （面積算出の共通定義域内でのみ使用する）。validateProfile 通過済みを前提とする内部関数。
 */
export function elevationAt(points: readonly SectionPoint[], offset: number): number {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    if (offset >= a.offset && offset <= b.offset) {
      const t = (offset - a.offset) / (b.offset - a.offset)
      return a.elevation + t * (b.elevation - a.elevation)
    }
  }
  // 定義域内でのみ呼ばれる前提だが、丸め誤差で右端をわずかに超えた場合の保険。
  return points[points.length - 1]!.elevation
}
