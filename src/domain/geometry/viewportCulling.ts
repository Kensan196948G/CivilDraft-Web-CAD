/**
 * ビューポートカリング。画面外図形の描画スキップ判定を行う。
 * 継承元: Civil-Draw src/utils/viewportCulling.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分:
 * - getShapeBBox → 移植済みshapeBBox()を再利用。BBox計算不可の図形（parametricObject等）は
 *   「画面内でない」扱いとする（parametricObjectの描画は生成図形側が個別に判定されるため）。
 * - グローバルシングルトンshapeIndexへの依存を廃止し、getVisibleIdsはGeometryIndexの
 *   インスタンスを引数で受け取る（Issue #7のインスタンス化改修と整合）。
 *
 * 座標系: world座標 = (screen座標 - pan) / zoom（ADR-0012: mm単位・Y軸下方向）。
 */
import type { Geometry, GeometryId } from '@/shared/types'
import { shapeBBox } from './shapeBBox'
import type { GeometryIndex } from './spatialIndex'

export interface Viewport {
  readonly zoom: number
  readonly panX: number
  readonly panY: number
  readonly width: number
  readonly height: number
}

/**
 * 図形のBBoxが可視ビューポート（world座標系、padding分外側拡張込み）と重なるか判定する。
 * 全図形を線形走査するO(N)経路。図形数が少ない場合や索引未構築時に使う。
 */
export function isInViewport(geometry: Geometry, vp: Viewport, padding = 50): boolean {
  const bbox = shapeBBox(geometry)
  if (bbox === null) return false

  const worldMinX = -vp.panX / vp.zoom - padding
  const worldMinY = -vp.panY / vp.zoom - padding
  const worldMaxX = worldMinX + vp.width / vp.zoom + padding * 2
  const worldMaxY = worldMinY + vp.height / vp.zoom + padding * 2

  return !(
    bbox.maxX < worldMinX ||
    bbox.minX > worldMaxX ||
    bbox.maxY < worldMinY ||
    bbox.minY > worldMaxY
  )
}

/**
 * R-tree索引によるビューポート内図形IDの一括取得。O(log N + k)でisInViewportのO(N)を置き換える。
 * 索引はstore層が保持するGeometryIndexインスタンスを渡す。
 */
export function getVisibleIds(index: GeometryIndex, vp: Viewport, padding = 50): Set<GeometryId> {
  const ids = index.search({
    minX: -vp.panX / vp.zoom - padding,
    minY: -vp.panY / vp.zoom - padding,
    maxX: -vp.panX / vp.zoom + vp.width / vp.zoom + padding,
    maxY: -vp.panY / vp.zoom + vp.height / vp.zoom + padding,
  })
  return new Set(ids)
}

/**
 * カリングは図形数が多いときだけ適用する価値がある（per-shape判定コストがあるため）。
 * 図形数がしきい値以上のときtrueを返す。
 */
export function shouldCull(shapeCount: number, threshold = 500): boolean {
  return shapeCount >= threshold
}
