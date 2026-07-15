/**
 * 単純多角形の面積・周長を靴紐公式（Shoelace formula）で計算する。
 * 継承元: Civil-Draw src/utils/areaCalculator.ts（継承台帳 modify、幾何演算エンジン群）。
 * 継承元はpoints: number[]（フラット配列）を受け取る設計だったが、詳細設計仕様書§6の
 * PolylineGeometry.pointsに合わせてPoint[]ベースへ変更した。
 *
 * 面積はmm²、周長はmm（ADR-0012: 内部座標基準）。頂点3未満は退化ケースとして0を返す。
 * 周長は閉路長（最終頂点→始点の辺を含む）。
 */
import type { Point } from '@/shared/types'

export interface PolygonMetrics {
  area: number
  perimeter: number
  vertexCount: number
}

export function computePolygonMetrics(points: readonly Point[]): PolygonMetrics {
  const n = points.length
  if (n < 3) {
    return { area: 0, perimeter: 0, vertexCount: n }
  }

  let signed = 0
  let perimeter = 0
  // n >= 3 が確定した直後のインデックスアクセスなので points[n - 1] は必ず存在する。
  let current = points[n - 1]!

  for (const next of points) {
    signed += current.x * next.y - next.x * current.y
    perimeter += Math.hypot(next.x - current.x, next.y - current.y)
    current = next
  }

  return { area: Math.abs(signed) / 2, perimeter, vertexCount: n }
}
