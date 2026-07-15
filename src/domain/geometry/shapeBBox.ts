/**
 * 図形の外接矩形（Axis-Aligned Bounding Box）を計算する。
 * 継承元: Civil-Draw src/utils/shapeBBox.ts（継承台帳 modify、幾何演算エンジン群）。
 * 継承元はShape型（14種）のフラット座標（x1/y1等）を扱う設計だったが、
 * 詳細設計仕様書§6のGeometry判別共用体（Issue #20で確定）に合わせて移植した。
 *
 * rectangle/ellipseはrotationDegを考慮せず回転前のAABBを返す（継承元のarcケース
 * "Conservative: use full circle bbox"と同じ設計方針を踏襲）。arcも同様に開始角・
 * 終了角を使わず全円近似とする。text/leaderの文字幅はフォントメトリクスを持たない
 * ため、継承元と同じ簡易近似（height/textHeightの10倍）を用いる。
 * parametricObjectは座標を直接持たない間接参照型（§15）のため計算不可としてnullを返す。
 */
import type { Geometry } from '@/shared/types'

export interface BBox {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export function shapeBBox(geometry: Geometry): BBox | null {
  switch (geometry.type) {
    case 'line':
      return {
        minX: Math.min(geometry.start.x, geometry.end.x),
        minY: Math.min(geometry.start.y, geometry.end.y),
        maxX: Math.max(geometry.start.x, geometry.end.x),
        maxY: Math.max(geometry.start.y, geometry.end.y),
      }
    case 'rectangle':
      return {
        minX: geometry.origin.x,
        minY: geometry.origin.y,
        maxX: geometry.origin.x + geometry.width,
        maxY: geometry.origin.y + geometry.height,
      }
    case 'circle':
      return {
        minX: geometry.center.x - geometry.radius,
        minY: geometry.center.y - geometry.radius,
        maxX: geometry.center.x + geometry.radius,
        maxY: geometry.center.y + geometry.radius,
      }
    case 'arc':
      return {
        minX: geometry.center.x - geometry.radius,
        minY: geometry.center.y - geometry.radius,
        maxX: geometry.center.x + geometry.radius,
        maxY: geometry.center.y + geometry.radius,
      }
    case 'ellipse':
      return {
        minX: geometry.center.x - geometry.radiusX,
        minY: geometry.center.y - geometry.radiusY,
        maxX: geometry.center.x + geometry.radiusX,
        maxY: geometry.center.y + geometry.radiusY,
      }
    case 'polyline':
    case 'spline': {
      if (geometry.points.length === 0) return null
      const xs = geometry.points.map((p) => p.x)
      const ys = geometry.points.map((p) => p.y)
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    }
    case 'hatch': {
      if (geometry.boundaryPoints.length === 0) return null
      const xs = geometry.boundaryPoints.map((p) => p.x)
      const ys = geometry.boundaryPoints.map((p) => p.y)
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    }
    case 'text':
      return {
        minX: geometry.anchor.x,
        minY: geometry.anchor.y - geometry.height,
        maxX: geometry.anchor.x + geometry.height * 10,
        maxY: geometry.anchor.y,
      }
    case 'dimension':
      return {
        minX: Math.min(geometry.start.x, geometry.end.x),
        minY: Math.min(geometry.start.y, geometry.end.y),
        maxX: Math.max(geometry.start.x, geometry.end.x),
        maxY: Math.max(geometry.start.y, geometry.end.y),
      }
    case 'leader':
      return {
        minX: Math.min(geometry.start.x, geometry.end.x),
        minY: Math.min(geometry.start.y, geometry.end.y),
        maxX: Math.max(geometry.start.x, geometry.end.x) + geometry.textHeight * 10,
        maxY: Math.max(geometry.start.y, geometry.end.y) + geometry.textHeight,
      }
    case 'symbol': {
      const r = 50 * geometry.scale
      return {
        minX: geometry.position.x - r,
        minY: geometry.position.y - r,
        maxX: geometry.position.x + r,
        maxY: geometry.position.y + r,
      }
    }
    case 'parametricObject':
      return null
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

export function unionBBox(geometries: readonly Geometry[]): BBox | null {
  const bboxes = geometries.map(shapeBBox).filter((b): b is BBox => b !== null)
  if (bboxes.length === 0) return null
  return {
    minX: Math.min(...bboxes.map((b) => b.minX)),
    minY: Math.min(...bboxes.map((b) => b.minY)),
    maxX: Math.max(...bboxes.map((b) => b.maxX)),
    maxY: Math.max(...bboxes.map((b) => b.maxY)),
  }
}
