/**
 * 図形オフセット（線分は法線方向へ平行移動、円/弧は半径増減、矩形は各辺を等距離拡縮）。
 * 継承元: Civil-Draw src/utils/offsetEngine.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分:
 * - Shape型（フラット座標）→ Geometry判別共用体（LineGeometry.start/end、CircleGeometry.center等）へ移植。
 * - オフセット図形のID発番を`nanoid()`直呼びから`GeometryCreationContext`注入（ADR-0013）へ変更。
 *   `ctx.newId()`で新IDを、`ctx.now()`でcreatedAt/updatedAtを設定し、layerId/style等はスプレッドで維持する。
 * - 継承元の`default: return null`を、詳細設計仕様書§6の全13種を列挙するexhaustive switchへ展開した
 *   （shapeBBox.tsと同じ網羅性検査スタイル）。非対応（ellipse/polyline/text/dimension/leader/hatch/
 *   symbol/spline/parametricObject）は明示的にnullを返す。
 * - 矩形は継承元同様rotationDeg（回転）を無視し、未回転座標系で各辺を距離d拡縮する。回転矩形では
 *   ワールド空間の真の平行オフセットにはならない継承元由来の制約（下部「懸念点」参照）。
 * - アルゴリズム（正のdで左側／外側へ）はas_is相当で忠実に移植した。
 */
import type { Geometry } from '@/shared/types'
import { defaultCreationContext } from './geometryFactory'
import type { GeometryCreationContext } from './geometryFactory'

/**
 * 単一図形を距離distanceだけオフセットする（正の値=左側／外側）。
 * 非対応図形種・退化ケース（長さ0・半径や辺長が0以下）はnullを返す。
 * ctx: 派生図形のID・タイムスタンプ発番コンテキスト（ADR-0013、省略時は既定実装）。
 */
export function offsetShape(
  geometry: Geometry,
  distance: number,
  ctx: GeometryCreationContext = defaultCreationContext,
): Geometry | null {
  switch (geometry.type) {
    case 'line': {
      const dx = geometry.end.x - geometry.start.x
      const dy = geometry.end.y - geometry.start.y
      const len = Math.hypot(dx, dy)
      if (len < 1e-12) return null
      // 進行方向の左向き法線（進行方向に対し垂直）。
      const nx = -dy / len
      const ny = dx / len
      const now = ctx.now()
      return {
        ...geometry,
        id: ctx.newId(),
        createdAt: now,
        updatedAt: now,
        start: { x: geometry.start.x + nx * distance, y: geometry.start.y + ny * distance },
        end: { x: geometry.end.x + nx * distance, y: geometry.end.y + ny * distance },
      }
    }
    case 'circle': {
      const r = geometry.radius + distance
      if (r <= 0) return null
      const now = ctx.now()
      return { ...geometry, id: ctx.newId(), createdAt: now, updatedAt: now, radius: r }
    }
    case 'arc': {
      const r = geometry.radius + distance
      if (r <= 0) return null
      const now = ctx.now()
      return { ...geometry, id: ctx.newId(), createdAt: now, updatedAt: now, radius: r }
    }
    case 'rectangle': {
      const width = geometry.width + distance * 2
      const height = geometry.height + distance * 2
      if (width <= 0 || height <= 0) return null
      const now = ctx.now()
      return {
        ...geometry,
        id: ctx.newId(),
        createdAt: now,
        updatedAt: now,
        origin: { x: geometry.origin.x - distance, y: geometry.origin.y - distance },
        width,
        height,
      }
    }
    case 'ellipse':
    case 'polyline':
    case 'text':
    case 'dimension':
    case 'leader':
    case 'hatch':
    case 'symbol':
    case 'spline':
    case 'parametricObject':
      return null
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** オフセット対応図形種か判定する（line / circle / arc / rectangle）。 */
export function canOffset(geometry: Geometry): boolean {
  return (
    geometry.type === 'line' ||
    geometry.type === 'circle' ||
    geometry.type === 'arc' ||
    geometry.type === 'rectangle'
  )
}
