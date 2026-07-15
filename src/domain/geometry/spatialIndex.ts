/**
 * R-tree（rbush）による空間索引。ビューポートカリングとヒットテストを高速化する。
 * 継承元: Civil-Draw src/utils/spatialIndex.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分（Issue #7: 空間索引のインスタンス化改修）:
 * - モジュールレベルシングルトン（export const shapeIndex）を廃止し、クラスのみexportする。
 *   インスタンスの生成・保持は呼び出し側（store層）の責務とし、複数図面・テスト分離を可能にする。
 * - Shape型14種 → Geometry判別共用体13種へ移行し、BBox計算はshapeBBox()を再利用する。
 * - shapeBBox()がnullを返す図形（parametricObject・空点列polyline等）は索引に登録しない。
 *   parametricObjectの当たり判定は生成図形（generatedGeometryIds）側が個別に索引されることで担保する。
 *
 * 計算量: 変更操作はO(log N)、一括ロードはrbushのbulk loadでO(N log N)。
 */
import RBush from 'rbush'
import type { Geometry, GeometryId } from '@/shared/types'
import { shapeBBox, type BBox } from './shapeBBox'

interface IndexItem {
  minX: number
  minY: number
  maxX: number
  maxY: number
  id: GeometryId
  /** 単調増加の挿入順序。最前面図形の解決をO(k)で行うために保持する。 */
  order: number
}

export class GeometryIndex {
  private tree = new RBush<IndexItem>()
  private byId = new Map<GeometryId, IndexItem>()
  private counter = 0

  /** 一括ロード（逐次addより高速）。配列順を挿入順序（=描画順）として保持する。 */
  load(geometries: readonly Geometry[]): void {
    this.tree.clear()
    this.byId.clear()
    this.counter = geometries.length
    const items: IndexItem[] = []
    geometries.forEach((g, i) => {
      const item = toItem(g, i)
      if (item !== null) items.push(item)
    })
    this.tree.load(items)
    for (const item of items) this.byId.set(item.id, item)
  }

  /** 1図形を追加する。同一IDが既存なら置き換える。BBox計算不可の図形は登録しない。 */
  add(geometry: Geometry): void {
    if (this.byId.has(geometry.id)) this.remove(geometry.id)
    const item = toItem(geometry, this.counter++)
    if (item === null) return
    this.tree.insert(item)
    this.byId.set(geometry.id, item)
  }

  /** IDで削除する。未登録IDはno-op。 */
  remove(id: GeometryId): void {
    const item = this.byId.get(id)
    if (!item) return
    this.tree.remove(item, (a, b) => a.id === b.id)
    this.byId.delete(id)
  }

  /** 図形の座標変更を反映する（旧BBoxを削除し新BBoxを挿入、挿入順序=重なり順は維持）。 */
  update(geometry: Geometry): void {
    const prev = this.byId.get(geometry.id)
    const order = prev?.order ?? this.counter++
    this.remove(geometry.id)
    const item = toItem(geometry, order)
    if (item === null) return
    this.tree.insert(item)
    this.byId.set(geometry.id, item)
  }

  /** BBoxが検索矩形と重なる図形のIDを返す。 */
  search(rect: BBox): GeometryId[] {
    return this.tree.search(rect).map((i) => i.id)
  }

  /** 点のtolerance近傍にBBoxが重なる図形のIDを返す。 */
  point(x: number, y: number, tolerance = 5): GeometryId[] {
    return this.search({
      minX: x - tolerance,
      minY: y - tolerance,
      maxX: x + tolerance,
      maxY: y + tolerance,
    })
  }

  /**
   * 候補IDのうち最前面（挿入順序が最大=最後に描画）のIDをO(k)で返す。
   * 図形配列の走査を必要としない。候補が空・全て未登録ならnull。
   */
  topmost(ids: readonly GeometryId[]): GeometryId | null {
    let bestOrder = -1
    let bestId: GeometryId | null = null
    for (const id of ids) {
      const item = this.byId.get(id)
      if (item && item.order > bestOrder) {
        bestOrder = item.order
        bestId = id
      }
    }
    return bestId
  }

  /** 索引に登録されている図形数（BBox計算不可で未登録の図形は含まない）。 */
  get size(): number {
    return this.byId.size
  }

  clear(): void {
    this.tree.clear()
    this.byId.clear()
    this.counter = 0
  }
}

function toItem(geometry: Geometry, order: number): IndexItem | null {
  const bbox = shapeBBox(geometry)
  if (bbox === null) return null
  return { ...bbox, id: geometry.id, order }
}
