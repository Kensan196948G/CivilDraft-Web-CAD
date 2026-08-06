/**
 * 数量の依存無効化と再計算（詳細設計仕様書 §17.3）。
 *
 * 図形・属性・単位・施工ステップ・丸め規則の変更を依存入力とし、変更された図形に紐づく数量を
 * stale 化 → 再計算要求 → 値・根拠・Issues を返す、という流れの純粋関数を提供する。
 * §7.2「コマンド確定後に数量依存関係を無効化し、再計算を要求する」の呼び出し口として、
 * Undo/Redo を含む EditorCommand から invalidateByGeometryChange を呼べる形にしている。
 *
 * stale の数量は照査提出・確定版作成を禁止する（§17.3）。本モジュールは状態遷移のみを担い、
 * 提出可否の判定は上位（照査層）が status を見て行う。
 */
import type {
  Geometry,
  GeometryId,
  QuantityItem,
  QuantityItemId,
  QuantitySource,
  Result,
  ValidationIssue,
} from '@/shared/types'
import { computeContribution, type VolumeOptions } from './quantityCalculator'
import { applyRounding } from './rounding'

/** 図形IDから、その図形を根拠に含む数量明細IDの集合を引く依存索引。 */
export type DependencyIndex = ReadonlyMap<GeometryId, ReadonlySet<QuantityItemId>>

/**
 * 数量明細群から依存索引を構築する（§17.3 Dependency Index）。
 * 1 図形が複数明細に寄与しうるため、値は QuantityItemId の集合。
 */
export function buildDependencyIndex(items: readonly QuantityItem[]): DependencyIndex {
  const index = new Map<GeometryId, Set<QuantityItemId>>()
  for (const item of items) {
    for (const source of item.sources) {
      const existing = index.get(source.geometryId)
      if (existing === undefined) {
        index.set(source.geometryId, new Set([item.id]))
      } else {
        existing.add(item.id)
      }
    }
  }
  return index
}

/**
 * 変更された図形に紐づく数量を stale 化する（§17.3）。
 * valid / manuallyAdjusted の明細のうち、根拠に変更図形を含むものを stale にする。
 * 既に stale / invalid の明細は変えない。純手動明細（sources 空）は図形非依存のため対象外。
 * 返り値は新しい配列（入力は不変）。
 */
export function invalidateByGeometryChange(
  items: readonly QuantityItem[],
  changedGeometryIds: Iterable<GeometryId>,
): readonly QuantityItem[] {
  const changed = new Set<GeometryId>(changedGeometryIds)
  if (changed.size === 0) return items
  const hasDependentItem = items.some(
    (item) =>
      (item.status === 'valid' || item.status === 'manuallyAdjusted') &&
      item.sources.some((source) => changed.has(source.geometryId)),
  )
  if (!hasDependentItem) return items
  return items.map((item) => {
    if (item.status !== 'valid' && item.status !== 'manuallyAdjusted') return item
    const dependsOnChanged = item.sources.some((source) => changed.has(source.geometryId))
    return dependsOnChanged ? { ...item, status: 'stale' } : item
  })
}

/**
 * 図面の前後差分から数量 state を同期する（Issue #116 Phase 3）。
 *
 * - 変更（同一 id・別参照）: 依存入力として invalidateByGeometryChange で依存明細を stale 化
 * - 削除: sources を保持したまま（= unlinked として保持）。checkDrawingHealth が
 *   存在しない図形 ID を参照する明細を unlinked-quantity として検出する
 * - 追加: 明細は変更しない（都度再計算による unlinked/stale の握り潰しを防ぐ。
 *   新図形は明細の再計算まで含めない）
 */
export function syncQuantityItemsByGeometryDiff(
  items: readonly QuantityItem[],
  prevGeometries: readonly Geometry[],
  nextGeometries: readonly Geometry[],
): readonly QuantityItem[] {
  const prevById = new Map<GeometryId, Geometry>(prevGeometries.map((geometry) => [geometry.id, geometry]))
  const changed: GeometryId[] = []
  for (const next of nextGeometries) {
    const prev = prevById.get(next.id)
    if (prev !== undefined && prev !== next) changed.push(next.id)
  }
  return invalidateByGeometryChange(items, changed)
}

/** 現在の図形集合を ID で引く関数。削除済み図形は undefined を返す。 */
export type GeometryLookup = (id: GeometryId) => Geometry | undefined

/** 再計算の任意入力。volume 明細の再計算に厚さが要る（QuantityItem は厚さを保持しないため外部注入）。 */
export interface RecomputeOptions {
  readonly volume?: VolumeOptions
}

/** 再計算結果。§17.3 の「値・根拠・Issues」に対応する（item.status が最終状態を表す）。 */
export interface RecomputeResult {
  readonly item: QuantityItem
  readonly issues: readonly ValidationIssue[]
}

/**
 * 1 明細を現在の図形から再計算する（§17.3）。
 * - 根拠図形の欠落・算出不能があれば status='invalid' とし、値は保持したまま issues を返す。
 * - 手動補正付き明細は roundedValue（人手値）を維持し、rawValue（自動基準）だけ更新して
 *   status='manuallyAdjusted' を保つ（§17.4 元値の温存）。
 * - 純手動明細（method='manual'）は図形非依存のため無変更で返す。
 */
export function recomputeQuantityItem(
  item: QuantityItem,
  lookup: GeometryLookup,
  options?: RecomputeOptions,
): RecomputeResult {
  if (item.method === 'manual') {
    return { item: { ...item, status: 'manuallyAdjusted' }, issues: [] }
  }

  const newSources: QuantitySource[] = []
  const issues: ValidationIssue[] = []
  for (const source of item.sources) {
    const geometry = lookup(source.geometryId)
    if (geometry === undefined) {
      issues.push({ code: 'QTY_SOURCE_MISSING', severity: 'error', entityId: item.id, message: `根拠図形 ${source.geometryId} が存在しない` })
      continue
    }
    const contribution = computeContribution(geometry, item.method, item.unit, { volume: options?.volume })
    if (!contribution.ok) {
      issues.push(contribution.error)
      continue
    }
    newSources.push({ geometryId: source.geometryId, contributionRaw: contribution.value })
  }

  if (issues.length > 0) {
    return { item: { ...item, status: 'invalid' }, issues }
  }

  const rawValue = newSources.reduce((sum, source) => sum + source.contributionRaw, 0)
  if (item.manualAdjustment !== undefined) {
    return {
      item: { ...item, sources: newSources, rawValue, roundedValue: item.manualAdjustment.adjustedValue, status: 'manuallyAdjusted' },
      issues: [],
    }
  }
  return {
    item: { ...item, sources: newSources, rawValue, roundedValue: applyRounding(rawValue, item.roundingRule), status: 'valid' },
    issues: [],
  }
}

/**
 * stale な明細をまとめて再計算する（§17.3 の再計算要求への一括応答）。
 * valid / manuallyAdjusted の明細はそのまま通す。個々の issues は集約して返す。
 */
export function recomputeStaleItems(
  items: readonly QuantityItem[],
  lookup: GeometryLookup,
  options?: RecomputeOptions,
): Result<QuantityItem[], readonly ValidationIssue[]> {
  const recomputed: QuantityItem[] = []
  const allIssues: ValidationIssue[] = []
  for (const item of items) {
    if (item.status !== 'stale') {
      recomputed.push(item)
      continue
    }
    const result = recomputeQuantityItem(item, lookup, options)
    recomputed.push(result.item)
    allIssues.push(...result.issues)
  }
  if (allIssues.length > 0) return { ok: false, error: allIssues }
  return { ok: true, value: recomputed }
}
