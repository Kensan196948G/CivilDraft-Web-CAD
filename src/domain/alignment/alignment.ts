/**
 * 線形（アライメント）: 直線・単曲線（円弧）要素の連続列としての中心線定義と、
 * 測点距離→座標の写像。詳細設計仕様書 §12.4（中心線・測点）・§13。
 *
 * 座標は内部mm、角度は内部rad（ADR-0012）。累加距離 `station` を線形上の位置に用いる。
 * 中心線は直線・円弧セグメントの連続列として保持し、接続不連続（前要素終点と次要素始点の
 * 位置ずれ）を検査する（§13.1「接続不連続を検査する」）。
 *
 * 簡易クロソイド要素は §13.2 により Phase 5 以降・別ADR確定事項のため、本フェーズの
 * セグメント種別には含めない。
 */
import { EPSILON_LENGTH_MM } from '@/domain/units'
import type { Point, Result, ValidationIssue } from '@/shared/types'
import type { CurveDirection, SingleCurve } from './singleCurve'

/** 直線セグメント（中心線要素）。座標は内部mm、方向は内部rad。 */
export interface LineAlignmentSegment {
  readonly kind: 'line'
  readonly start: Point
  readonly end: Point
  /** 進行方向（始点→終点、X軸正方向=0、内部rad）。 */
  readonly directionRad: number
  /** セグメント長（mm）。 */
  readonly length: number
  /** セグメント始端の累加距離（mm）。 */
  readonly startStation: number
  /** セグメント終端の累加距離（mm）。 */
  readonly endStation: number
}

/** 円弧（単曲線）セグメント（中心線要素）。座標は内部mm、角度は内部rad。 */
export interface ArcAlignmentSegment {
  readonly kind: 'arc'
  readonly start: Point
  readonly end: Point
  readonly center: Point
  readonly radius: number
  /** 始角（中心→始点、内部rad）。 */
  readonly startAngleRad: number
  /** 符号付き掃引角（右折で正・左折で負、内部rad）。 */
  readonly sweepAngleRad: number
  readonly direction: CurveDirection
  readonly length: number
  readonly startStation: number
  readonly endStation: number
}

/** 中心線を構成するセグメント（直線 または 円弧）。 */
export type AlignmentSegment = LineAlignmentSegment | ArcAlignmentSegment

/** 線形（中心線）。詳細設計仕様書§13の Alignment 相当。`endStation` は計算済みの終端累加距離。 */
export interface Alignment {
  readonly id: string
  readonly name: string
  readonly startStation: number
  readonly segments: readonly AlignmentSegment[]
  readonly endStation: number
}

/** 線形を構成する要素の入力。座標は内部mm。 */
export type AlignmentElement =
  | { readonly kind: 'line'; readonly start: Point; readonly end: Point }
  | { readonly kind: 'arc'; readonly curve: SingleCurve }

/** 線形構築の入力。 */
export interface AlignmentBuildInput {
  readonly id: string
  readonly name: string
  /** 開始測点（累加距離の起点、mm）。既定0。 */
  readonly startStation?: number
  readonly elements: readonly AlignmentElement[]
}

/** 線形構築オプション。 */
export interface AlignmentBuildOptions {
  /** 接続不連続判定の座標許容差（mm）。既定は ADR-0012 の距離許容差。 */
  readonly coordinateEpsilonMm?: number
}

/** 測点距離→座標の写像結果。 */
export interface AlignmentPoint {
  readonly point: Point
  /** その点での進行方向（内部rad）。 */
  readonly tangentDirectionRad: number
  /** 該当セグメントの添字。 */
  readonly segmentIndex: number
  /** 入力測点（mm）。 */
  readonly station: number
}

function fail<T>(code: string, message: string, field?: string): Result<T, ValidationIssue> {
  return { ok: false, error: { code, severity: 'error', ...(field ? { field } : {}), message } }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * 要素列から線形を構築する。各要素の長さ・累加距離を割り付け、隣接要素の接続不連続を検査する。
 * 直線は長さ0、円弧は曲線長0を退化として拒否する。
 */
export function buildAlignment(
  input: AlignmentBuildInput,
  options: AlignmentBuildOptions = {},
): Result<Alignment, ValidationIssue> {
  const epsilon = options.coordinateEpsilonMm ?? EPSILON_LENGTH_MM
  if (input.elements.length === 0) {
    return fail('alignment_empty', '線形には1つ以上の要素が必要です', 'elements')
  }

  const startStation = input.startStation ?? 0
  if (!Number.isFinite(startStation)) {
    return fail('alignment_start_station_invalid', '開始測点が不正です', 'startStation')
  }

  const segments: AlignmentSegment[] = []
  let station = startStation
  let previousEnd: Point | null = null
  let index = 0

  for (const element of input.elements) {
    if (previousEnd !== null) {
      const gap = distance(previousEnd, elementStart(element))
      if (gap > epsilon) {
        return fail(
          'alignment_discontinuous',
          `要素${index}の始点が前要素の終点と一致しません（ずれ ${gap.toFixed(6)}mm）`,
          'elements',
        )
      }
    }

    if (element.kind === 'line') {
      const length = distance(element.start, element.end)
      if (length <= EPSILON_LENGTH_MM) {
        return fail('alignment_line_zero_length', `要素${index}の直線長が0です`, 'elements')
      }
      const endStation = station + length
      segments.push({
        kind: 'line',
        start: element.start,
        end: element.end,
        directionRad: Math.atan2(element.end.y - element.start.y, element.end.x - element.start.x),
        length,
        startStation: station,
        endStation,
      })
      station = endStation
      previousEnd = element.end
    } else {
      const curve = element.curve
      const length = curve.curveLength
      if (length <= EPSILON_LENGTH_MM) {
        return fail('alignment_arc_zero_length', `要素${index}の曲線長が0です`, 'elements')
      }
      const endStation = station + length
      segments.push({
        kind: 'arc',
        start: curve.bc,
        end: curve.ec,
        center: curve.center,
        radius: curve.radius,
        startAngleRad: curve.startAngleRad,
        sweepAngleRad: curve.sweepAngleRad,
        direction: curve.direction,
        length,
        startStation: station,
        endStation,
      })
      station = endStation
      previousEnd = curve.ec
    }
    index += 1
  }

  return {
    ok: true,
    value: { id: input.id, name: input.name, startStation, segments, endStation: station },
  }
}

function elementStart(element: AlignmentElement): Point {
  return element.kind === 'line' ? element.start : element.curve.bc
}

/** 直線セグメント上の測点写像。局所距離 `local`（0..length）から座標と進行方向を返す。 */
function pointOnLine(segment: LineAlignmentSegment, local: number): AlignmentPoint {
  return {
    point: {
      x: segment.start.x + Math.cos(segment.directionRad) * local,
      y: segment.start.y + Math.sin(segment.directionRad) * local,
    },
    tangentDirectionRad: segment.directionRad,
    segmentIndex: -1,
    station: 0,
  }
}

/** 円弧セグメント上の測点写像。局所距離 `local`（0..length）から座標と進行方向（接線）を返す。 */
function pointOnArc(segment: ArcAlignmentSegment, local: number): AlignmentPoint {
  const fraction = local / segment.length
  const angle = segment.startAngleRad + segment.sweepAngleRad * fraction
  const sign = Math.sign(segment.sweepAngleRad) || 1
  // 接線（進行方向）= 半径方向 (cos,sin) を掃引の符号方向へ90度回した向き。
  const tangentX = -Math.sin(angle) * sign
  const tangentY = Math.cos(angle) * sign
  return {
    point: {
      x: segment.center.x + segment.radius * Math.cos(angle),
      y: segment.center.y + segment.radius * Math.sin(angle),
    },
    tangentDirectionRad: Math.atan2(tangentY, tangentX),
    segmentIndex: -1,
    station: 0,
  }
}

/**
 * 測点距離→座標の写像。`station` は累加距離（mm）。範囲外は Result エラーを返す。
 * セグメント境界（曲線境界）ではどちらのセグメントで評価しても連続性により同一点となる。
 */
export function stationToPoint(
  alignment: Alignment,
  station: number,
): Result<AlignmentPoint, ValidationIssue> {
  if (!Number.isFinite(station)) {
    return fail('alignment_station_invalid', '測点が不正です', 'station')
  }
  if (
    station < alignment.startStation - EPSILON_LENGTH_MM ||
    station > alignment.endStation + EPSILON_LENGTH_MM
  ) {
    return fail(
      'alignment_station_out_of_range',
      `測点 ${station} は線形範囲 [${alignment.startStation}, ${alignment.endStation}] 外です`,
      'station',
    )
  }

  for (let i = 0; i < alignment.segments.length; i++) {
    const segment = alignment.segments[i]
    if (segment === undefined) continue
    if (station <= segment.endStation + EPSILON_LENGTH_MM) {
      const local = clamp(station - segment.startStation, 0, segment.length)
      const mapped =
        segment.kind === 'line' ? pointOnLine(segment, local) : pointOnArc(segment, local)
      return { ok: true, value: { ...mapped, segmentIndex: i, station } }
    }
  }

  // 数値誤差で末尾を超えた場合は終端で評価する。
  const last = alignment.segments[alignment.segments.length - 1]
  if (last !== undefined) {
    const mapped =
      last.kind === 'line' ? pointOnLine(last, last.length) : pointOnArc(last, last.length)
    return {
      ok: true,
      value: { ...mapped, segmentIndex: alignment.segments.length - 1, station },
    }
  }
  return fail('alignment_empty', '線形にセグメントがありません', 'segments')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 測点ピッチ配置の測点列を生成する（詳細設計仕様書§12.4）。
 * 開始・終了・各セグメント境界（曲線境界）を必ず含め、ピッチ倍数を追加し、重複を除去して昇順で返す。
 * `pitchMm` が非正・非有限の場合は境界（開始・終了・セグメント境界）のみを返す。
 */
export function generateStations(alignment: Alignment, pitchMm: number): readonly number[] {
  const raw: number[] = [alignment.startStation, alignment.endStation]
  for (const segment of alignment.segments) {
    raw.push(segment.startStation, segment.endStation)
  }

  if (Number.isFinite(pitchMm) && pitchMm > 0) {
    // 開始測点から次のピッチ境界へ丸め、終端までピッチ倍数を追加する。
    const firstMultiple = Math.ceil(alignment.startStation / pitchMm) * pitchMm
    for (let s = firstMultiple; s <= alignment.endStation + EPSILON_LENGTH_MM; s += pitchMm) {
      raw.push(s)
    }
  }

  raw.sort((a, b) => a - b)
  const result: number[] = []
  for (const s of raw) {
    const last = result[result.length - 1]
    if (last === undefined || Math.abs(s - last) > EPSILON_LENGTH_MM) {
      result.push(s)
    }
  }
  return result
}
