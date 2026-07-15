/**
 * 施工ステップによる図形フィルタリング（詳細設計仕様書 §18）。
 *
 * 中心となる判定は isGeometryInStep のみで、表示フィルター（filterGeometriesByStep）と
 * 数量フィルター（selectGeometriesForQuantity）は**同じ判定サービスを利用する**（§18）。
 * これにより「表示されているが集計されない」等の不整合を構造的に防ぐ。
 *
 * §6.3 の横断規則（非表示レイヤーの図形を数量集計対象に含めるかは別設定で判定）は、
 * レイヤー可視状態を本モジュールが保持せず、注入述語 isLayerCounted として受け取ることで満たす
 * （レイヤー状態の所有・非表示判定は呼び出し側の責務。ステップ判定とは直交させる）。
 */
import type { ConstructionStepId, GeometryBase } from '@/shared/types'

/** 施工ステップ紐付けを持つ最小構造（Geometry 全体でなくても判定可能にする）。 */
type StepBearing = Pick<GeometryBase, 'constructionStepIds'>

/**
 * 図形が指定ステップで有効か判定する共通サービス（表示・数量で共用）。
 * constructionStepIds が空配列なら全ステップ共通（常に true）。それ以外は当該ステップを含むか。
 */
export function isGeometryInStep(geometry: StepBearing, stepId: ConstructionStepId): boolean {
  if (geometry.constructionStepIds.length === 0) return true
  return geometry.constructionStepIds.includes(stepId)
}

/**
 * 表示用フィルター: 現在ステップで有効な図形のみを返す（§18 の表示規則）。
 * currentStepId が null のときは「全表示」とし、全図形をそのまま返す。
 * 入力配列は変更せず、新しい配列を返す純関数。
 */
export function filterGeometriesByStep<T extends StepBearing>(
  geometries: readonly T[],
  currentStepId: ConstructionStepId | null,
): T[] {
  if (currentStepId === null) return [...geometries]
  return geometries.filter((g) => isGeometryInStep(g, currentStepId))
}

/**
 * 数量集計用の図形選別（§18 表示/数量の判定共用 + §6.3 レイヤー別設定）。
 * まず表示フィルターと同一の isGeometryInStep でステップ選別し、続いて §6.3 の
 * レイヤー集計可否を注入述語 isLayerCounted で適用する。
 * @param isLayerCounted 図形が集計対象レイヤーに属するか（既定は全レイヤー集計= true）。
 */
export function selectGeometriesForQuantity<T extends StepBearing>(
  geometries: readonly T[],
  currentStepId: ConstructionStepId | null,
  isLayerCounted: (geometry: T) => boolean = () => true,
): T[] {
  return filterGeometriesByStep(geometries, currentStepId).filter(isLayerCounted)
}
