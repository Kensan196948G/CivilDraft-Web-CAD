/**
 * 図形選択のためのBBox判定・図形検索ユーティリティ。
 * 継承元: Civil-Draw src/utils/selection.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元はgetShapeBBox（Shape型14種のBBox計算）を本ファイルに同居させていたが、
 * 新設計ではBBox計算をdomain/geometry/shapeBBox.tsに分離済みのため再実装せず、
 * shapeBBox()とBBox型を再利用する（責務: BBox計算=shapeBBox.ts、選択判定=本ファイル）。
 *
 * shapeBBox()はparametricObject・空点列polyline等でnullを返すため、
 * BBoxを計算できない図形は「選択にヒットしない」として扱う（継承元に無い分岐）。
 */
import type { Geometry, GeometryId, Point } from '@/shared/types'
import { shapeBBox, type BBox } from './shapeBBox'

/** 点がBBoxの内側（tolerance分の外側拡張込み）にあるか判定する。 */
export function bboxContainsPoint(bbox: BBox, p: Point, tolerance = 0): boolean {
  return (
    p.x >= bbox.minX - tolerance &&
    p.x <= bbox.maxX + tolerance &&
    p.y >= bbox.minY - tolerance &&
    p.y <= bbox.maxY + tolerance
  )
}

/** 2つのBBoxが重なる（辺・角の接触を含む）か判定する。 */
export function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}

/** 対角2点から正規化済み（min<=max保証）のBBoxを作る。矩形選択のドラッグ始点・終点用。 */
export function rectFromPoints(p1: Point, p2: Point): BBox {
  return {
    minX: Math.min(p1.x, p2.x),
    minY: Math.min(p1.y, p2.y),
    maxX: Math.max(p1.x, p2.x),
    maxY: Math.max(p1.y, p2.y),
  }
}

/** 矩形と重なる全図形のIDを返す（矩形選択）。BBox計算不可の図形は対象外。 */
export function findShapesInRect(geometries: readonly Geometry[], rect: BBox): GeometryId[] {
  return geometries
    .filter((g) => {
      const bbox = shapeBBox(g)
      return bbox !== null && bboxIntersects(bbox, rect)
    })
    .map((g) => g.id)
}

/**
 * 点にヒットする最前面（配列末尾側=後から描画）の図形IDを返す（クリック選択）。
 * ヒットなし・BBox計算不可の図形のみの場合はnull。
 */
export function findShapeAtPoint(
  geometries: readonly Geometry[],
  p: Point,
  tolerance = 5,
): GeometryId | null {
  for (let i = geometries.length - 1; i >= 0; i--) {
    const g = geometries[i]
    if (g === undefined) continue
    const bbox = shapeBBox(g)
    if (bbox !== null && bboxContainsPoint(bbox, p, tolerance)) {
      return g.id
    }
  }
  return null
}
