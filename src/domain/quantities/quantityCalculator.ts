/**
 * 図形から数量（丸め前の寄与値）を算出する純粋関数群（詳細設計仕様書 §17.2 算出規則）。
 *
 * | method    | 対象                             | 算出 |
 * | length    | 線・ポリライン・円弧・管渠 等     | 各図形の実寸長（開いた経路長） |
 * | perimeter | 閉図形                           | 外周長（閉ループ長） |
 * | area      | 円・矩形・閉ポリゴン・ハッチ 等   | 実寸面積 |
 * | count     | 記号・部材・パラメトリック図形    | 対象個数（1 図形 = 1） |
 * | volume    | 面積×厚さ 等                     | 明示した厚さによる簡易体積 |
 * | manual    | 自動算出不可                     | 本モジュールでは扱わない（manualAdjustment 参照） |
 *
 * 内部算出は ADR-0012 の基準単位（長さ=mm、面積=mm²、体積=mm³）で行い、
 * 最終的に QuantityUnit へ換算して返す。面積・周長は areaCalculator を再利用する。
 */
import type { Geometry, QuantityMethod, QuantityUnit, Result, ValidationIssue } from '@/shared/types'
import { computePolygonMetrics } from '@/domain/geometry/areaCalculator'
import {
  areaMm2ToUnit,
  isUnitConsistentWithMethod,
  lengthMmToUnit,
  volumeMm3ToUnit,
} from './quantityUnits'

/** 簡易体積（volume）算出に必要な厚さ（内部基準 mm）。面積×厚さの明示式に用いる（§17.2）。 */
export interface VolumeOptions {
  readonly thicknessMm: number
}

/** computeContribution の任意入力。volume 算出時のみ volume を必須とする。 */
export interface ContributionOptions {
  readonly volume?: VolumeOptions
}

function segmentLengthSum(points: readonly { x: number; y: number }[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!
    const curr = points[i]!
    sum += Math.hypot(curr.x - prev.x, curr.y - prev.y)
  }
  return sum
}

/** 円弧の掃引角（度）を 0 < sweep <= 360 に正規化する。始終角が一致する場合は全円（360）とみなす。 */
function normalizedArcSweepDeg(startDeg: number, endDeg: number): number {
  const sweep = ((endDeg - startDeg) % 360 + 360) % 360
  return sweep === 0 ? 360 : sweep
}

/** ラマヌジャン近似による楕円周長（内部基準 mm）。a・b は半径。 */
function ellipsePerimeterMm(a: number, b: number): number {
  const h = (a - b) ** 2 / (a + b) ** 2
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

/**
 * 開いた経路としての実寸長（内部基準 mm）。閉図形・注記図形・座標を持たない図形は null。
 * ポリライン/スプラインは closed でも閉辺を加えない（延長は経路長として扱う）。
 * スプラインは制御点を結ぶ折れ線長で近似する（張力による曲線長は近似対象外）。
 */
export function geometryLengthMm(geometry: Geometry): number | null {
  switch (geometry.type) {
    case 'line':
      return Math.hypot(geometry.end.x - geometry.start.x, geometry.end.y - geometry.start.y)
    case 'mline':
      return Math.hypot(geometry.end.x - geometry.start.x, geometry.end.y - geometry.start.y)
    case 'polyline':
    case 'spline':
      return geometry.points.length < 2 ? null : segmentLengthSum(geometry.points)
    case 'arc':
      return (geometry.radius * normalizedArcSweepDeg(geometry.startAngleDeg, geometry.endAngleDeg) * Math.PI) / 180
    case 'circle':
    case 'rectangle':
    case 'ellipse':
    case 'hatch':
    case 'cloud':
    case 'text':
    case 'dimension':
    case 'leader':
    case 'symbol':
    case 'parametricObject':
      return null
    default: {
      const exhaustive: never = geometry
      throw new Error(`未知の図形種別: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * 閉図形の外周長（内部基準 mm）。開いた図形・注記図形は null。
 * ポリライン/ハッチ境界は閉ループ（末尾→始点の辺を含む）として周長を算出する。
 */
export function geometryPerimeterMm(geometry: Geometry): number | null {
  switch (geometry.type) {
    case 'circle':
      return 2 * Math.PI * geometry.radius
    case 'rectangle':
      return 2 * (geometry.width + geometry.height)
    case 'ellipse':
      return ellipsePerimeterMm(geometry.radiusX, geometry.radiusY)
    case 'polyline':
      return geometry.points.length < 3 ? null : computePolygonMetrics(geometry.points).perimeter
    case 'hatch':
      return geometry.boundaryPoints.length < 3 ? null : computePolygonMetrics(geometry.boundaryPoints).perimeter
    case 'line':
    case 'arc':
    case 'spline':
    case 'cloud':
    case 'mline':
    case 'text':
    case 'dimension':
    case 'leader':
    case 'symbol':
    case 'parametricObject':
      return null
    default: {
      const exhaustive: never = geometry
      throw new Error(`未知の図形種別: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * 閉領域の実寸面積（内部基準 mm²）。開いた図形・注記図形は null。
 * ポリラインは closed に関わらず靴紐公式で閉領域として算出する（§17.2 閉ポリゴン）。
 */
export function geometryAreaMm2(geometry: Geometry): number | null {
  switch (geometry.type) {
    case 'circle':
      return Math.PI * geometry.radius ** 2
    case 'rectangle':
      return geometry.width * geometry.height
    case 'ellipse':
      return Math.PI * geometry.radiusX * geometry.radiusY
    case 'polyline':
      return geometry.points.length < 3 ? null : computePolygonMetrics(geometry.points).area
    case 'hatch':
      return geometry.boundaryPoints.length < 3 ? null : computePolygonMetrics(geometry.boundaryPoints).area
    case 'line':
    case 'arc':
    case 'spline':
    case 'cloud':
    case 'mline':
    case 'text':
    case 'dimension':
    case 'leader':
    case 'symbol':
    case 'parametricObject':
      return null
    default: {
      const exhaustive: never = geometry
      throw new Error(`未知の図形種別: ${JSON.stringify(exhaustive)}`)
    }
  }
}

function issue(code: string, message: string, entityId?: string): ValidationIssue {
  return { code, severity: 'error', message, entityId }
}

/**
 * 1 図形の丸め前寄与値（QuantityUnit 表示単位）を算出する（§17.2）。
 * method と unit の次元が不整合な場合、対象図形が算出対象外の場合、
 * volume で厚さが未指定/非正の場合はエラー（ValidationIssue）を返す。
 * manual は自動算出しないため常にエラー（手動補正は applyManualAdjustment / buildManualQuantityItem を使う）。
 */
export function computeContribution(
  geometry: Geometry,
  method: QuantityMethod,
  unit: QuantityUnit,
  options?: ContributionOptions,
): Result<number, ValidationIssue> {
  if (!isUnitConsistentWithMethod(method, unit)) {
    return {
      ok: false,
      error: issue('QTY_UNIT_METHOD_MISMATCH', `算出区分 ${method} と単位 ${unit} が不整合`, geometry.id),
    }
  }

  switch (method) {
    case 'length': {
      const mm = geometryLengthMm(geometry)
      if (mm === null) return { ok: false, error: issue('QTY_LENGTH_UNSUPPORTED', `図形種別 ${geometry.type} は延長を算出できない`, geometry.id) }
      return { ok: true, value: lengthMmToUnit(mm, unit) }
    }
    case 'perimeter': {
      const mm = geometryPerimeterMm(geometry)
      if (mm === null) return { ok: false, error: issue('QTY_PERIMETER_UNSUPPORTED', `図形種別 ${geometry.type} は外周を算出できない`, geometry.id) }
      return { ok: true, value: lengthMmToUnit(mm, unit) }
    }
    case 'area': {
      const mm2 = geometryAreaMm2(geometry)
      if (mm2 === null) return { ok: false, error: issue('QTY_AREA_UNSUPPORTED', `図形種別 ${geometry.type} は面積を算出できない`, geometry.id) }
      return { ok: true, value: areaMm2ToUnit(mm2, unit) }
    }
    case 'volume': {
      const mm2 = geometryAreaMm2(geometry)
      if (mm2 === null) return { ok: false, error: issue('QTY_VOLUME_UNSUPPORTED', `図形種別 ${geometry.type} は面積が算出できず体積不能`, geometry.id) }
      const thickness = options?.volume?.thicknessMm
      if (thickness === undefined || !(thickness > 0)) {
        return { ok: false, error: issue('QTY_VOLUME_THICKNESS_REQUIRED', '簡易体積には正の厚さ(thicknessMm)が必要', geometry.id) }
      }
      return { ok: true, value: volumeMm3ToUnit(mm2 * thickness, unit) }
    }
    case 'count':
      return { ok: true, value: 1 }
    case 'manual':
      return { ok: false, error: issue('QTY_MANUAL_NOT_COMPUTABLE', 'manual は自動算出できない（手動補正を用いる）', geometry.id) }
    default: {
      const exhaustive: never = method
      throw new Error(`未知の算出区分: ${String(exhaustive)}`)
    }
  }
}
