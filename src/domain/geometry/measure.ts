/**
 * 測距・面積計測（Civil-Draw MEASURE-001/002 相当の純粋関数群）。
 *
 * 内部座標は mm（ADR-0012）。返り値は mm / mm² で、表示側（UI）で単位換算する。
 * 面積は靴紐公式（areaCalculator と同一実装）で、3 点以上の閉点列を対象とする。
 */
import type { Point } from '@/shared/types'
import { computePolygonMetrics } from './areaCalculator'

export interface MeasureDistanceResult {
  readonly distanceMm: number
  readonly dxMm: number
  readonly dyMm: number
  /** X 軸正方向からの角度（°、Y 下方向を正＝時計回り）。 */
  readonly angleDeg: number
}

/** 2 点間の距離・XY 成分・方位角を算出する。点不足は null。 */
export function measureDistance(points: readonly Point[]): MeasureDistanceResult | null {
  const [a, b] = points
  if (a === undefined || b === undefined) return null
  const dx = b.x - a.x
  const dy = b.y - a.y
  return {
    distanceMm: Math.hypot(dx, dy),
    dxMm: dx,
    dyMm: dy,
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  }
}

export interface MeasureAreaResult {
  readonly areaMm2: number
  readonly perimeterMm: number
  readonly vertexCount: number
  readonly closed: boolean
}

/**
 * 点列の面積・周長を算出する。3 点未満は退化として null。
 * closed=true のときのみ面積を算出する（UI 側は「閉じる」操作で閉点列を作る）。
 */
export function measureArea(points: readonly Point[], closed: boolean): MeasureAreaResult | null {
  if (points.length < 3) return null
  const metrics = computePolygonMetrics(points)
  return {
    areaMm2: closed ? metrics.area : 0,
    perimeterMm: metrics.perimeter,
    vertexCount: metrics.vertexCount,
    closed,
  }
}
