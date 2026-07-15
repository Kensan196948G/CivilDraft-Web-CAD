/**
 * 断面の切土・盛土面積の算出（詳細設計仕様書 §16.2）。
 *
 * アルゴリズム:
 * - 現況線（existingGround）と計画線（plannedGround）の差 d(offset) = 現況標高 − 計画標高 を評価する。
 *   d > 0（現況が計画より高い）を**切土**、d < 0（計画が現況より高い）を**盛土**とする。
 * - 両線の offset 頂点をすべて区間境界（breakpoint）に取り、さらに現況線・計画線の交点
 *   （d の符号反転点）を挿入して区間を分割する（§16.2「交点を挿入して区間を分割し、切土・盛土領域を分類」）。
 * - 各区間内では両線が線形なので d も線形となり、区間ごとに |d| を台形積分して面積を得る。
 * - 面積は mm²（ADR-0012: 内部座標基準）。切土・盛土を別々に集計する。
 *
 * 面積未確定（Result.ok=false）となる条件:
 * - 断面線が validateProfile を満たさない（線分不足 / 同一 offset 重複 / 自己交差 / 非有限値）。
 * - 現況線・計画線の offset 定義域が重複しない（比較領域が存在しない）。
 */
import type { Result, ValidationIssue } from '@/shared/types'
import type { Section, SectionPoint } from './section'
import { elevationAt, validateProfile } from './section'

/** 領域の種別（切土 / 盛土）。 */
export type SectionRegionKind = 'cut' | 'fill'

/** 切土・盛土に分類された 1 区間の領域（境界多角形と面積）。 */
export interface SectionRegion {
  readonly kind: SectionRegionKind
  /** 領域境界（offset/elevation 座標、現況側→計画側の順で閉多角形を成す）。 */
  readonly polygon: readonly SectionPoint[]
  /** 領域面積 mm²（常に正）。 */
  readonly area: number
}

/** 断面面積の算出結果。 */
export interface SectionAreaResult {
  /** 切土総面積 mm²。 */
  readonly cutArea: number
  /** 盛土総面積 mm²。 */
  readonly fillArea: number
  /** 切土・盛土に分類された各区間領域（ハッチ生成等に利用）。 */
  readonly regions: readonly SectionRegion[]
  /** 面積を算出した現況線・計画線の共通 offset 定義域。 */
  readonly domain: { readonly from: number; readonly to: number }
  /** 情報レベルの注意（面積未確定ではないが留意すべき事項）。 */
  readonly warnings: readonly ValidationIssue[]
}

/**
 * 断面の切土・盛土面積を算出する。
 * 未確定条件（§16.2）に該当する場合は ok:false で全 issue を返す（複数条件の同時報告のため error は配列）。
 */
export function computeSectionAreas(
  section: Section,
): Result<SectionAreaResult, readonly ValidationIssue[]> {
  const issues = [
    ...validateProfile(section.existingGround, 'existingGround'),
    ...validateProfile(section.plannedGround, 'plannedGround'),
  ]
  if (issues.length > 0) {
    return { ok: false, error: issues }
  }

  const ex = section.existingGround
  const pl = section.plannedGround
  const exLo = ex[0]!.offset
  const exHi = ex[ex.length - 1]!.offset
  const plLo = pl[0]!.offset
  const plHi = pl[pl.length - 1]!.offset
  const lo = Math.max(exLo, plLo)
  const hi = Math.min(exHi, plHi)

  if (!(lo < hi)) {
    return {
      ok: false,
      error: [
        {
          code: 'SECTION_NO_OVERLAP',
          severity: 'error',
          message: `現況線・計画線の offset 定義域が重複せず面積未確定です（共通域=[${lo}, ${hi}]）`,
        },
      ],
    }
  }

  // 区間境界: 共通域の両端 + 共通域内にある両線の頂点 offset。
  const breakSet = new Set<number>([lo, hi])
  for (const p of ex) if (p.offset > lo && p.offset < hi) breakSet.add(p.offset)
  for (const p of pl) if (p.offset > lo && p.offset < hi) breakSet.add(p.offset)
  const breaks = [...breakSet].sort((a, b) => a - b)

  const regions: SectionRegion[] = []
  let cutArea = 0
  let fillArea = 0

  // [a, b] 区間（両端で d=da, db、同符号）を切土/盛土へ分類し面積を積む。
  const emit = (a: number, b: number, da: number, db: number): void => {
    const width = b - a
    if (width <= 0) return
    const area = ((Math.abs(da) + Math.abs(db)) / 2) * width
    if (area === 0) return
    // da+db の符号で分類（分割済みのため区間内は同符号、0 は非ゼロ側に従う）。
    const kind: SectionRegionKind = da + db >= 0 ? 'cut' : 'fill'
    const polygon: SectionPoint[] = [
      { offset: a, elevation: elevationAt(ex, a) },
      { offset: b, elevation: elevationAt(ex, b) },
      { offset: b, elevation: elevationAt(pl, b) },
      { offset: a, elevation: elevationAt(pl, a) },
    ]
    regions.push({ kind, polygon, area })
    if (kind === 'cut') cutArea += area
    else fillArea += area
  }

  for (let i = 0; i < breaks.length - 1; i++) {
    const x0 = breaks[i]!
    const x1 = breaks[i + 1]!
    const d0 = elevationAt(ex, x0) - elevationAt(pl, x0)
    const d1 = elevationAt(ex, x1) - elevationAt(pl, x1)
    if (d0 === 0 && d1 === 0) continue // 両線一致区間（面積 0）
    if (d0 * d1 < 0) {
      // 符号反転 → 交点 xc を挿入して 2 領域へ分割。
      const xc = x0 + ((x1 - x0) * d0) / (d0 - d1)
      emit(x0, xc, d0, 0)
      emit(xc, x1, 0, d1)
    } else {
      emit(x0, x1, d0, d1)
    }
  }

  const warnings: ValidationIssue[] = []
  if (lo > Math.min(exLo, plLo) || hi < Math.max(exHi, plHi)) {
    warnings.push({
      code: 'SECTION_DOMAIN_TRIMMED',
      severity: 'info',
      message: `現況線・計画線の共通 offset 域[${lo}, ${hi}]のみで面積を算出しました（非共通部分は評価対象外）`,
    })
  }

  return {
    ok: true,
    value: { cutArea, fillArea, regions, domain: { from: lo, to: hi }, warnings },
  }
}

/**
 * 断面へ算出済みの切土・盛土面積を反映した新しい Section を返す。
 * 未確定（validateProfile 不成立・定義域非重複）の場合は cutArea/fillArea を undefined にする（§16.2）。
 */
export function applyComputedAreas(section: Section): Section {
  const result = computeSectionAreas(section)
  if (!result.ok) {
    return { ...section, cutArea: undefined, fillArea: undefined }
  }
  return { ...section, cutArea: result.value.cutArea, fillArea: result.value.fillArea }
}
